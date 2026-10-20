"use client";

import { useMemo, useState } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import type { ChatMessageDto } from "@/dto/chat.dto";
import { streamChat } from "@/lib/chat-api";
import { Thread } from "./assistant-ui/thread";

export function Chat() {
  // One cache per mounted app, never a module-global cache shared by SSR requests.
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <ChatRuntime />
    </QueryClientProvider>
  );
}

function ChatRuntime() {
  const { mutateAsync } = useMutation({
    mutationFn: streamChat,
    retry: false, // Never replay a paid generation automatically.
    gcTime: 0, // No retained mutation cache after observers detach.
    networkMode: "always", // Fail offline rather than queue an obsolete conversation.
  });

  const adapter = useMemo<ChatModelAdapter>(
    () => ({
      async *run({ messages, abortSignal }) {
        const cancellation = new AbortController();
        const signal = AbortSignal.any([abortSignal, cancellation.signal]);
        const request = {
          messages: messages.flatMap<ChatMessageDto>((message) => {
            if (message.role === "system") return [];
            const content = message.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n");
            // Failed/cancelled runs can leave an empty assistant message in history.
            if (message.role === "assistant" && !content.trim()) return [];
            return [{ role: message.role, content }];
          }),
        };

        let cancelled = false;
        let completion: Promise<void>;
        // Bridge the mutation's callbacks into assistant-ui's async-generator interface.
        // ponytail: buffered reply is capped at 2048 server tokens; add backpressure if that budget grows.
        const updates = new ReadableStream<string>({
          start(controller) {
            completion = mutateAsync({
              request,
              signal,
              onDelta(delta) {
                if (!cancelled) controller.enqueue(delta);
              },
            }).then(
              () => {
                if (!cancelled) controller.close();
              },
              (error: unknown) => {
                if (!cancelled) controller.error(error);
              },
            );
          },
          cancel() {
            cancelled = true;
            cancellation.abort();
          },
        });
        const reader = updates.getReader();
        let text = "";
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            text += value;
            // assistant-ui replaces content each time; yield full accumulated text.
            yield { content: [{ type: "text", text }] };
          }
        } finally {
          cancellation.abort();
          await reader.cancel().catch(() => {});
          reader.releaseLock();
          await completion!;
        }
      },
    }),
    [mutateAsync],
  );

  const runtime = useLocalRuntime(adapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}
