"use client";

import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import { readChatStream } from "@/lib/chat-stream";
import { Thread } from "./assistant-ui/thread";

const modelAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abortSignal,
      body: JSON.stringify({
        messages: messages
          .map((message) => ({
            role: message.role,
            content: message.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n"),
          }))
          // Failed/cancelled runs can leave an empty assistant message in history.
          .filter((message) => message.role !== "assistant" || message.content.trim()),
      }),
    });
    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null);
      const message =
        typeof data === "object" &&
        data !== null &&
        "error" in data &&
        typeof data.error === "string"
          ? data.error
          : "Chat request failed. Please retry.";
      throw new Error(message);
    }
    if (!response.body) throw new Error("The server returned an empty response.");

    let text = "";
    for await (const delta of readChatStream(response.body)) {
      text += delta;
      // assistant-ui replaces content on each yield: send accumulated text, not just the delta.
      yield { content: [{ type: "text", text }] };
    }
  },
};

export function Chat() {
  const runtime = useLocalRuntime(modelAdapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}
