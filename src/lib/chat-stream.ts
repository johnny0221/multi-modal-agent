import type { ChatEventDto } from "../dto/chat.dto";

export function encodeChatEvent(event: ChatEventDto): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(event) + "\n");
}

// Network chunks do not line up with JSON records or even UTF-8 characters.
export async function* readChatStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!line.trim()) continue;
        const event: unknown = JSON.parse(line);
        if (typeof event !== "object" || event === null || !("type" in event)) {
          throw new Error("Invalid chat stream.");
        }
        if (event.type === "done") return;
        if (event.type === "error" && "message" in event && typeof event.message === "string") {
          throw new Error(event.message);
        }
        if (event.type !== "delta" || !("text" in event) || typeof event.text !== "string") {
          throw new Error("Invalid chat stream.");
        }
        yield event.text;
      }
    }
    throw new Error("Connection ended before the response completed. Please retry.");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
