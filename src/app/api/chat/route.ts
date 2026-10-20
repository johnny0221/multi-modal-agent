import type { ChatErrorDto } from "../../../dto/chat.dto";
import { ApiError } from "../../../lib/api-error";
import { readChatRequest } from "../../../lib/chat-request";
import { encodeChatEvent } from "../../../lib/chat-stream";
import { createChatResponse } from "../../../server/chat/chat.service";

function errorResponse(error: unknown, fallback: string, status: number): Response {
  const body: ChatErrorDto = { error: error instanceof ApiError ? error.message : fallback };
  return Response.json(body, { status: error instanceof ApiError ? error.statusCode : status });
}

export async function POST(request: Request): Promise<Response> {
  // Local-only prototype: this is not authentication. Add auth/rate limits before deployment.
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  // Next.js may normalize request.url to localhost; Host retains the browser-facing address.
  const expectedOrigin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (origin && origin !== expectedOrigin) {
    return errorResponse(
      new ApiError("Cross-origin requests are not allowed.", 403),
      "Forbidden.",
      403,
    );
  }

  let dto;
  try {
    dto = await readChatRequest(request);
  } catch (error) {
    return errorResponse(error, "Could not read the request.", 400);
  }

  try {
    const session = await createChatResponse(dto, request.signal);
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { value, done } = await session.events.next();
        if (cancelled) return;
        if (done) controller.close();
        else controller.enqueue(encodeChatEvent(value));
      },
      async cancel() {
        cancelled = true;
        // Abort first, so a blocked upstream read cannot delay iterator cleanup.
        session.cancel();
        await session.events.return();
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return errorResponse(error, "Could not complete the response. Please retry.", 500);
  }
}
