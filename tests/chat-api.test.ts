import { beforeEach, expect, test, vi } from "vite-plus/test";
import { streamChat } from "../src/lib/chat-api";
import { encodeChatEvent } from "../src/lib/chat-stream";
import type { ChatEventDto } from "../src/dto/chat.dto";

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("axios", () => ({ default: { create: () => ({ post }) } }));

beforeEach(() => post.mockReset());

function events(values: ChatEventDto[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of values) controller.enqueue(encodeChatEvent(event));
      controller.close();
    },
  });
}

const request = { messages: [{ role: "user" as const, content: "Hello" }] };

test("Axios chat forwards abort signal and delivers incremental text until done", async () => {
  const signal = new AbortController().signal;
  const onDelta = vi.fn();
  post.mockResolvedValue({
    status: 200,
    data: events([
      { type: "delta", text: "Hello " },
      { type: "delta", text: "你好" },
      { type: "done" },
    ]),
  });
  await streamChat({ request, signal, onDelta });
  expect(onDelta.mock.calls).toEqual([["Hello "], ["你好"]]);
  expect(post).toHaveBeenCalledWith("/api/chat", request, expect.objectContaining({ signal }));
  expect(post).toHaveBeenCalledOnce();
});

test("JSON HTTP errors are decoded from Axios response streams", async () => {
  post.mockResolvedValue({
    status: 503,
    data: new Response(JSON.stringify({ error: "Configure API key" })).body,
  });
  await expect(
    streamChat({ request, signal: new AbortController().signal, onDelta: vi.fn() }),
  ).rejects.toThrow("Configure API key");
  expect(post).toHaveBeenCalledOnce();
});

test("stream failure rejects mutation rather than reporting successful completion", async () => {
  post.mockResolvedValue({
    status: 200,
    data: events([
      { type: "delta", text: "Partial" },
      { type: "error", message: "Interrupted" },
    ]),
  });
  await expect(
    streamChat({ request, signal: new AbortController().signal, onDelta: vi.fn() }),
  ).rejects.toThrow("Interrupted");
});
