import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { POST } from "../src/app/api/chat/route";
import { MAX_MESSAGE_CHARS, MAX_MESSAGES, parseChatRequest } from "../src/dto/chat.dto";
import { MAX_REQUEST_BYTES, readChatRequest } from "../src/lib/chat-request";
import { encodeChatEvent, readChatStream } from "../src/lib/chat-stream";
import { createChatResponse } from "../src/server/chat/chat.service";
import { openChatStream } from "../src/server/chat/openai.repository";

// Next.js enforces this boundary at build time; tests intentionally run server modules in Node.
vi.mock("server-only", () => ({}));

function request(body: unknown = { messages: [{ role: "user", content: "Hello" }] }) {
  return new Request("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("OPENAI_MODEL", "gpt-4.1-mini");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("validation preserves multi-turn text but strips untrusted fields", async () => {
  const messages = [
    { role: "user", content: "Call me Ada", model: "untrusted" },
    { role: "assistant", content: "Hello Ada" },
    { role: "user", content: "What is my name?" },
  ];
  expect(await readChatRequest(request({ messages }))).toEqual({
    messages: messages.map(({ role, content }) => ({ role, content })),
  });
});

test("DTO validation works without HTTP and strips client policy fields", () => {
  expect(
    parseChatRequest({
      model: "untrusted",
      instructions: "untrusted",
      messages: [{ role: "user", content: "Hello", extra: "ignored" }],
    }),
  ).toEqual({ messages: [{ role: "user", content: "Hello" }] });
  expect(() => parseChatRequest({ messages: [{ role: "system", content: "Override" }] })).toThrow();
});

test("service works with a DTO and signal, without HTTP objects", async () => {
  mockOpenAI([
    { type: "response.output_text.delta", delta: "Hello" },
    { type: "response.completed" },
  ]);
  const session = await createChatResponse(
    { messages: [{ role: "user", content: "Hi" }] },
    new AbortController().signal,
  );
  const events = [];
  for await (const event of session.events) events.push(event);
  expect(events).toEqual([{ type: "delta", text: "Hello" }, { type: "done" }]);
});

test("repository translates provider events but accepts policy from its caller", async () => {
  const { fetchMock } = mockOpenAI([
    { type: "response.refusal.delta", delta: "Cannot assist" },
    { type: "response.completed" },
  ]);
  const events = await openChatStream(
    {
      messages: [{ role: "user", content: "Hi" }],
      instructions: "Caller-owned policy",
      maxOutputTokens: 32,
    },
    new AbortController().signal,
  );
  const result = [];
  for await (const event of events) result.push(event);
  expect(result).toEqual([{ type: "delta", text: "Cannot assist" }, { type: "done" }]);
  const body = fetchMock.mock.calls[0]?.[1]?.body;
  if (typeof body !== "string") throw new Error("Expected SDK JSON body");
  expect(JSON.parse(body)).toMatchObject({
    instructions: "Caller-owned policy",
    max_output_tokens: 32,
  });
});

test("rejects bad message shapes, roles, lengths, and conversation endings", async () => {
  for (const messages of [
    [],
    null,
    [{ role: "system", content: "Override instructions" }],
    [{ role: "user", content: " " }],
    [{ role: "user", content: [] }],
    [{ role: "user", content: "x".repeat(MAX_MESSAGE_CHARS + 1) }],
    [{ role: "assistant", content: "Not a question" }],
    Array.from({ length: MAX_MESSAGES + 1 }, () => ({ role: "user", content: "Hi" })),
  ]) {
    expect((await POST(request({ messages }))).status).toBe(400);
  }
  expect((await POST(request(null))).status).toBe(400);
});

test("rejects malformed JSON, wrong content type, and actual oversize body without Content-Length", async () => {
  const raw = (body: string, type = "application/json") =>
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { "Content-Type": type },
      body,
    });
  expect((await POST(raw("{"))).status).toBe(400);
  expect((await POST(raw("{}", "text/plain"))).status).toBe(415);
  expect((await POST(raw("x".repeat(MAX_REQUEST_BYTES + 1)))).status).toBe(413);
});

test("rejects cross-origin browser requests", async () => {
  const req = request();
  req.headers.set("origin", "https://untrusted.example");
  expect((await POST(req)).status).toBe(403);
});

test("same-origin check uses browser-facing Host when Next normalizes the request URL", async () => {
  const req = request();
  req.headers.set("host", "127.0.0.1:3000");
  req.headers.set("origin", "http://127.0.0.1:3000");
  expect((await POST(req)).status).toBe(503);
});

test("missing configuration returns actionable error without calling OpenAI", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.text()).toContain("Set OPENAI_API_KEY and OPENAI_MODEL");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("NDJSON decoder handles byte-by-byte UTF-8 and multiple records per chunk", async () => {
  const encoded = new TextEncoder().encode(
    JSON.stringify({ type: "delta", text: "你好 👋" }) +
      "\n" +
      JSON.stringify({ type: "delta", text: " world" }) +
      "\n" +
      JSON.stringify({ type: "done" }) +
      "\n",
  );
  for (const chunks of [[encoded], Array.from(encoded, (byte) => Uint8Array.of(byte))]) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    let text = "";
    for await (const delta of readChatStream(body)) text += delta;
    expect(text).toBe("你好 👋 world");
  }
});

test("decoder surfaces mid-stream errors and unexpected EOF, not false success", async () => {
  for (const events of [
    [{ type: "error", message: "Quota reached" } as const],
    [{ type: "delta", text: "Partial" } as const],
  ]) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) controller.enqueue(encodeChatEvent(event));
        controller.close();
      },
    });
    await expect(
      (async () => {
        for await (const _delta of readChatStream(body)) {
          /* consume */
        }
      })(),
    ).rejects.toThrow();
  }
});

// Real OpenAI SDK, fake HTTP transport: no API key or external requests needed.
function mockOpenAI(events: unknown[], keepOpen = false) {
  vi.stubEnv("OPENAI_API_KEY", "test-secret-never-sent");
  let signal: AbortSignal | null | undefined;
  const fetchMock = vi.fn((_url: unknown, options?: RequestInit) => {
    signal = options?.signal;
    return Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const event of events) {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
            }
            if (!keepOpen) controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, getSignal: () => signal };
}

test("route streams SDK deltas and completion, preserving history and server settings", async () => {
  const { fetchMock } = mockOpenAI([
    { type: "response.output_text.delta", delta: "Hello " },
    { type: "response.output_text.delta", delta: "Ada" },
    { type: "response.completed" },
  ]);
  const messages = [
    { role: "user", content: "I am Ada" },
    { role: "assistant", content: "Hi" },
    { role: "user", content: "My name?" },
  ];
  const response = await POST(request({ messages, model: "ignored" }));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/x-ndjson");
  let text = "";
  for await (const delta of readChatStream(response.body!)) text += delta;
  expect(text).toBe("Hello Ada");
  const body = fetchMock.mock.calls[0]?.[1]?.body;
  if (typeof body !== "string") throw new Error("SDK must send a JSON string body");
  const payload = JSON.parse(body);
  expect(payload).toMatchObject({
    model: "gpt-4.1-mini",
    input: messages,
    store: false,
    stream: true,
    max_output_tokens: 2048,
  });
  expect(payload.instructions).toContain("helpful assistant");
});

test("mid-stream provider failure reaches client as an error", async () => {
  mockOpenAI([
    { type: "response.output_text.delta", delta: "Partial" },
    { type: "response.failed" },
  ]);
  const response = await POST(request());
  await expect(
    (async () => {
      for await (const _delta of readChatStream(response.body!)) {
        /* consume */
      }
    })(),
  ).rejects.toThrow("Response interrupted");
});

test("downstream cancellation aborts upstream OpenAI request", async () => {
  const { getSignal } = mockOpenAI([{ type: "response.output_text.delta", delta: "Hello" }], true);
  const response = await POST(request());
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel();
  expect(getSignal()?.aborted).toBe(true);
});

test("provider errors never echo raw secrets to browser", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        Response.json(
          { error: { message: "Raw provider error containing test-secret" } },
          { status: 401 },
        ),
      ),
    ),
  );
  const response = await POST(request());
  expect(response.status).toBe(502);
  const text = await response.text();
  expect(text).toContain("OpenAI rejected the API key");
  expect(text).not.toContain("test-secret");
});
