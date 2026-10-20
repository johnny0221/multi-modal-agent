import { ApiError } from "../lib/api-error";

export type ChatMessageDto = {
  role: "user" | "assistant";
  content: string;
};

export type ChatRequestDto = { messages: ChatMessageDto[] };

export type ChatEventDto =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export type ChatErrorDto = { error: string };

export const MAX_MESSAGES = 40;
export const MAX_MESSAGE_CHARS = 16_000;

// TypeScript types disappear at runtime. Validate untrusted JSON before using the DTO.
export function parseChatRequest(body: unknown): ChatRequestDto {
  if (typeof body !== "object" || body === null || !("messages" in body)) {
    throw new ApiError("A messages array is required.");
  }
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES) {
    throw new ApiError(`Send between 1 and ${MAX_MESSAGES} messages. Start a new chat if needed.`);
  }

  const validated = messages.map((message: unknown): ChatMessageDto => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("role" in message) ||
      (message.role !== "user" && message.role !== "assistant") ||
      !("content" in message) ||
      typeof message.content !== "string" ||
      !message.content.trim() ||
      message.content.length > MAX_MESSAGE_CHARS
    ) {
      throw new ApiError(
        `Messages need a user/assistant role and 1–${MAX_MESSAGE_CHARS} characters of text.`,
      );
    }
    // Copy only allowed fields. Clients cannot supply model settings or instructions.
    return { role: message.role, content: message.content };
  });
  if (validated.at(-1)?.role !== "user") {
    throw new ApiError("The last message must come from the user.");
  }
  return { messages: validated };
}
