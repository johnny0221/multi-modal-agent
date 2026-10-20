import { z } from "zod";
import { ApiError } from "../lib/api-error";

export const MAX_MESSAGES = 40;
export const MAX_MESSAGE_CHARS = 16_000;

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z
    .string()
    .max(MAX_MESSAGE_CHARS)
    .refine((text) => text.trim().length > 0, "Message text cannot be blank."),
});

// z.object strips unknown keys, including client-supplied model settings/instructions.
export const ChatRequestSchema = z
  .object({
    messages: z.array(ChatMessageSchema).min(1).max(MAX_MESSAGES),
  })
  .refine(
    (request) => request.messages.at(-1)?.role === "user",
    "The last message must come from the user.",
  );

export const ChatEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

export const ChatErrorSchema = z.object({ error: z.string() });

export type ChatMessageDto = z.infer<typeof ChatMessageSchema>;
export type ChatRequestDto = z.infer<typeof ChatRequestSchema>;
export type ChatEventDto = z.infer<typeof ChatEventSchema>;
export type ChatErrorDto = z.infer<typeof ChatErrorSchema>;

export function parseChatRequest(body: unknown): ChatRequestDto {
  const result = ChatRequestSchema.safeParse(body);
  if (!result.success)
    throw new ApiError(result.error.issues[0]?.message ?? "Invalid chat request.");
  return result.data;
}
