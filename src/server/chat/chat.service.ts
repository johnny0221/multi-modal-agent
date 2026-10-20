import "server-only";
import type { ChatEventDto, ChatRequestDto } from "../../dto/chat.dto";
import { ApiError } from "../../lib/api-error";
import { openChatStream } from "./openai.repository";

// Use-case policy: instructions, output budget, timeout, and user-facing stream failures.
export async function createChatResponse(
  request: ChatRequestDto,
  requestSignal: AbortSignal,
): Promise<{ events: AsyncGenerator<ChatEventDto, void>; cancel: () => void }> {
  const cancellation = new AbortController();
  const signal = AbortSignal.any([requestSignal, cancellation.signal, AbortSignal.timeout(90_000)]);

  let upstream: AsyncGenerator<ChatEventDto, void>;
  try {
    upstream = await openChatStream(
      {
        messages: request.messages,
        instructions: "You are a helpful assistant. Answer clearly and use Markdown when useful.",
        maxOutputTokens: 2048,
      },
      signal,
    );
  } catch (error) {
    if (signal.aborted) throw new ApiError("Request cancelled or timed out. Please retry.", 504);
    throw error;
  }

  async function* events(): AsyncGenerator<ChatEventDto, void> {
    try {
      yield* upstream;
    } catch {
      if (!requestSignal.aborted && !cancellation.signal.aborted) {
        yield {
          type: "error",
          message:
            "Response interrupted or output limit reached. Please retry or ask for a shorter answer.",
        };
      }
    } finally {
      cancellation.abort();
    }
  }
  return { events: events(), cancel: () => cancellation.abort() };
}
