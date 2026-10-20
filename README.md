# Multimodal Agent

A hands-on learning project. Phase 1 is text chat using Next.js App Router, assistant-ui, and the OpenAI Agents SDK. React Query manages client requests, Axios handles HTTP streaming, and Zod validates data. No Vercel AI SDK.

## Run locally

```bash
pnpm install
# If .env does not exist yet:
cp .env.example .env
```

Fill in `OPENAI_API_KEY` in `.env`. `OPENAI_MODEL` starts as `gpt-4.1-mini`; change it to a Responses API model available to your OpenAI account. API access requires API billing/quota, separately from a ChatGPT subscription. Restart the server after editing environment variables.

```bash
pnpm dev
```

Open http://127.0.0.1:3000. The UI loads without a key; sending a message shows a configuration error until the key is supplied.

`.env` is gitignored. Only `.env.example` should be committed. Never prefix API keys with `NEXT_PUBLIC_`.

**Local prototype only:** dev/start bind to `127.0.0.1`. There is no authentication or per-user rate limiting. Do not expose this endpoint publicly until both are added, together with spending controls. Same-origin checking is not authentication.

## Phase 1 learning checkpoints

### 1. UI and state

Start at `src/components/assistant-ui/thread.tsx`. The UI composes assistant-ui's Thread, Message, Composer, Error, and ActionBar primitives; Tailwind handles the shell and plain CSS styles Markdown. No unsupported upload/tool buttons.

`src/components/chat.tsx` creates `useLocalRuntime(adapter)`. assistant-ui owns messages, generation state, new chats, and cancellation. Chat history is not persisted: refresh loses conversations.

The component also creates a per-app React Query `QueryClient`. `useMutation` wraps the **entire streamed request**, not just receipt of HTTP headers. `src/lib/chat-api.ts` uses Axios's fetch adapter with `responseType: "stream"`; its XHR adapter would buffer rather than expose browser ReadableStreams. There are no direct frontend `fetch()` calls.

Chat POSTs are mutations, not cached answers. Automatic retries are disabled to avoid replaying paid generations, and offline sends fail instead of being queued. No cacheable read endpoints exist yet; future metadata/source-list GET requests can use `useQuery` and cache invalidation. Do not confuse React Query's server-data cache with assistant-ui's conversation state.

**Try:** send a message, copy a reply, start a new chat, and refresh.

### 2. Browser/server boundary

```text
page.tsx (server-rendered shell)
  → Chat (assistant-ui runtime + React Query mutation)
  → Axios streaming request
  → POST /api/chat (HTTP route)
  → createChatResponse (service: chat policy)
  → openChatStream (repository: Agent + Runner + OpenAIProvider)
  → OpenAI Responses API
```

Read `src/components/chat.tsx`, then follow these three backend layers:

| Layer      | File                                   | Owns                                                                           |
| ---------- | -------------------------------------- | ------------------------------------------------------------------------------ |
| API route  | `src/app/api/chat/route.ts`            | Origin check, HTTP input, status codes, NDJSON response, disconnect handling   |
| Service    | `src/server/chat/chat.service.ts`      | Instructions, output budget, timeout, cancellation, safe mid-stream failures   |
| Repository | `src/server/chat/openai.repository.ts` | Agents SDK execution, provider configuration, event/error translation, cleanup |

`src/dto/chat.dto.ts` defines Zod schemas and infers request/message/event/error DTOs from them. Schemas validate message shape, roles, limits, and streamed events; unknown request fields are stripped. `src/dto/source.dto.ts` also uses Zod for embedding validation. **DTO is a contract, not a fourth execution layer.** TypeScript types alone do not validate JSON; `parseChatRequest` does that at runtime. `src/lib/chat-request.ts` handles HTTP content type, body byte limits, and JSON parsing before calling the DTO validator. `src/lib/api-error.ts` carries intentional public errors to the route; unexpected errors get a generic response.

The adapter converts UI content parts into `{ role, content }` text messages and sends the current conversation on every turn. This is context, not persistent memory. Empty assistant messages from failed/cancelled runs are omitted.

Browser-supplied model settings are ignored. Only user/assistant text messages are accepted; clients cannot submit a system instruction. The service and repository are marked `server-only`, so importing them into a client component fails the Next.js build.

The OpenAI repository remains an external API access boundary, not conversation persistence. Supabase source/chunk persistence is a separate foundation described below. Layers use plain functions; no dependency-injection container, base classes, or unused repository interfaces.

The repository builds one `Agent` and runs it through `Runner` with the OpenAI Responses provider. Its low-level OpenAI client only configures transport/retries; application code no longer calls `responses.create` directly. The service still supplies instructions and token budget. The run is capped at one turn with no tools/handoffs yet, and tracing is disabled so conversation data is not exported through tracing by default. `store: false` remains enabled.

**Try:** lower `maxOutputTokens` in the service and request a long explanation. The repository should receive the new budget without any route/frontend edits.

**Try:** say “My name is Ada,” then ask “What is my name?” Inspect the second request in browser DevTools: it includes the earlier user message and assistant answer, but never an API key.

### 3. Streaming and cancellation

OpenAI sends structured events, not one finished string. The repository translates provider events into `ChatEventDto` values, the service handles stream failures, and the route encodes newline-delimited JSON records:

```json
{"type":"delta","text":"Hello"}
{"type":"delta","text":" world"}
{"type":"done"}
```

The Agents SDK starts work asynchronously. The repository waits for the first normalized text/completion event before returning the session, so configuration/provider startup failures still get a proper HTTP error status. A later failure becomes an `error` record instead of a new HTTP status. `src/lib/chat-stream.ts` decodes records across arbitrary network/UTF-8 chunk boundaries and rejects a stream that ends without `done`.

The adapter accumulates deltas before yielding: assistant-ui replaces message content on each yield. Yielding only the newest delta would lose earlier text.

Stop cancels the Axios request via AbortSignal; disconnect/cancellation aborts the upstream agent run. The repository awaits `result.completed` before emitting `done`—last text token alone does not establish successful completion. The server also limits requests to 90 seconds. Cancelled requests may still incur charges for work already performed.

**Try:** request a long explanation, press Stop, then ask a follow-up. Watch the cancelled request in DevTools. Retry regenerates the response and makes another API call.

### 4. Guardrails and checks

- Request body: at most 128 KiB, enforced while reading (not just through Content-Length).
- Conversation: 1–40 messages, at most 16,000 characters per message; ends with a user message.
- Output: at most 2,048 tokens. Truncation is shown as an incomplete response, not success.
- Missing key/model, rejected key, unavailable model, quota/rate limit, and interrupted streams produce visible errors without exposing raw provider errors.
- No silent history truncation. Start a new chat when limits are reached.

```bash
pnpm lint    # Oxlint + type-aware checks; warnings fail
pnpm format  # Oxfmt
pnpm check   # Formatting, lint, types
pnpm test    # Vite+ bundled test runner; no real OpenAI requests
pnpm build   # Next.js production build
pnpm start   # Serve production build on loopback
```

`tests/chat.test.ts` checks Zod DTO validation, direct service/repository calls, byte limits, configuration errors, UTF-8 stream framing, history conversion, safe provider errors, and cancellation using the real Agents SDK with fake HTTP transport. `tests/chat-api.test.ts` checks Axios request arguments, streamed JSON errors, and incremental text handling.

Real-model verification still requires your own key. Chat is not yet connected to PDF processing or RAG.

## Phase 2: Supabase foundation

See [Supabase setup and learning guide](supabase/README.md) for the proposed schema, secret configuration, private bucket, migration commands, and checks. SQL/repositories are prepared locally; the migration has **not** been applied to your hosted database automatically.

```bash
pnpm test:sql      # Check migration/search/security using disposable local Postgres (Docker)
pnpm test:supabase # Opt-in check against your configured Supabase DEV project; requires setup
```

No upload UI, PDF parsing/chunking, embedding generation, chat-history persistence, or chat-to-RAG wiring yet.

## References

- [assistant-ui components](https://www.assistant-ui.com/components)
- [LocalRuntime and ChatModelAdapter](https://www.assistant-ui.com/docs/runtimes/custom/local-runtime)
- [OpenAI Agents SDK streaming](https://openai.github.io/openai-agents-js/guides/streaming/)
- [React Query mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations)
- [Axios](https://axios-http.com/)
- [Zod](https://zod.dev/)
- [Vite+ lint configuration](https://viteplus.dev/guide/lint)
