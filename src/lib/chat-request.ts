import { parseChatRequest, type ChatRequestDto } from "../dto/chat.dto";
import { ApiError } from "./api-error";

export const MAX_REQUEST_BYTES = 128 * 1024;

// HTTP transport guard: enforce real body size, even without Content-Length.
export async function readChatRequest(request: Request): Promise<ChatRequestDto> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
    throw new ApiError("Send an application/json request.", 415);
  }
  if (!request.body) throw new ApiError("Request body is required.");

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new ApiError("Conversation is too large. Start a new chat.", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError("Request body must be valid JSON.");
  }
  return parseChatRequest(body);
}
