"use client";

import {
  ActionBarPrimitive,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadListPrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";

// Compose assistant-ui's Thread primitives, without attachment/tool controls for Phase 1.
export function Thread() {
  return (
    <ThreadPrimitive.Root className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4 sm:px-8">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Multimodal Agent</h1>
          <p className="mt-1 text-xs text-zinc-400">Learning lab · Phase 1: text chat</p>
        </div>
        <ThreadListPrimitive.New className="rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800">
          + New chat
        </ThreadListPrimitive.New>
      </header>

      <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-8 sm:px-8">
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <section className="m-auto w-full max-w-3xl py-12 text-center">
            <span className="rounded-full border border-emerald-800 bg-emerald-950/50 px-3 py-1 text-xs text-emerald-300">
              Start with a conversation
            </span>
            <h2 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
              What would you like to explore?
            </h2>
            <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-zinc-400">
              Ask a question, work through an idea, or learn something new. Text only for now—more
              modalities come next.
            </p>
          </section>
        </AuiIf>
        <div className="mx-auto w-full max-w-3xl">
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        </div>

        <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mx-auto mt-auto w-full max-w-3xl bg-zinc-950 pb-4 pt-6">
          <ThreadPrimitive.ScrollToBottom
            className="mx-auto mb-3 block rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs disabled:invisible"
            aria-label="Scroll to latest message"
          >
            ↓ Latest
          </ThreadPrimitive.ScrollToBottom>
          <ComposerPrimitive.Root className="rounded-2xl border border-zinc-700 bg-zinc-900 p-3 focus-within:border-zinc-500">
            <ComposerPrimitive.Input
              aria-label="Message"
              placeholder="Message Multimodal Agent…"
              rows={2}
              maxLength={16000}
              className="max-h-48 w-full resize-none bg-transparent p-1 text-sm outline-none placeholder:text-zinc-500"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-500">
                Enter to send · Shift + Enter for a new line
              </span>
              <AuiIf condition={(s) => !s.thread.isRunning}>
                <ComposerPrimitive.Send
                  aria-label="Send message"
                  className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-white disabled:opacity-40"
                >
                  Send ↑
                </ComposerPrimitive.Send>
              </AuiIf>
              <AuiIf condition={(s) => s.thread.isRunning}>
                <ComposerPrimitive.Cancel
                  aria-label="Stop generation"
                  className="rounded-lg border border-zinc-600 px-4 py-2 text-sm hover:bg-zinc-800"
                >
                  Stop ■
                </ComposerPrimitive.Cancel>
              </AuiIf>
            </div>
          </ComposerPrimitive.Root>
          <p className="mt-3 text-center text-xs text-zinc-500">
            AI can make mistakes. Chats stay in memory and disappear on refresh.
          </p>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="mb-8 flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-zinc-800 px-5 py-3 text-sm leading-7 whitespace-pre-wrap wrap-anywhere">
        <span className="sr-only">You: </span>
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="mb-8 text-sm leading-7 wrap-anywhere">
      <p className="mb-2 text-xs font-semibold tracking-wide text-emerald-300">ASSISTANT</p>
      <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
      <AuiIf condition={(s) => s.message.status?.type === "running"}>
        <output className="mt-2 block animate-pulse text-xs text-zinc-400 motion-reduce:animate-none">
          Responding…
        </output>
      </AuiIf>
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root
          role="alert"
          className="mt-3 rounded-lg border border-red-900 bg-red-950/30 p-3 text-red-200"
        >
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Error>
      <ActionBarPrimitive.Root hideWhenRunning className="mt-3 flex gap-4 text-xs text-zinc-400">
        <ActionBarPrimitive.Copy className="hover:text-white">Copy</ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload className="hover:text-white">Retry</ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

function MarkdownText() {
  return <MarkdownTextPrimitive className="markdown" remarkPlugins={[remarkGfm]} />;
}
