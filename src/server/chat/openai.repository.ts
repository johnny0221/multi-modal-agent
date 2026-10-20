import "server-only";
import {
  Agent,
  OpenAIProvider,
  Runner,
  assistant,
  user,
  isOpenAIResponsesRawModelStreamEvent,
} from "@openai/agents";
import OpenAI from "openai";
import type { ChatEventDto, ChatMessageDto } from "../../dto/chat.dto";
import { ApiError } from "../../lib/api-error";

function providerError(error: unknown): ApiError {
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401)
      return new ApiError("OpenAI rejected the API key. Check server configuration.", 502);
    if (error.status === 429)
      return new ApiError(
        "OpenAI rate limit or quota reached. Check billing or try again later.",
        429,
      );
    if (error.status === 404)
      return new ApiError("Configured OpenAI model is unavailable. Check OPENAI_MODEL.", 502);
  }
  return new ApiError("OpenAI could not complete the response. Please retry.", 502);
}

// The Agents SDK owns model execution; the service supplies chat policy.
export async function openChatStream(
  options: { messages: ChatMessageDto[]; instructions: string; maxOutputTokens: number },
  signal: AbortSignal,
): Promise<AsyncGenerator<ChatEventDto, void>> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  if (!apiKey || !model) {
    throw new ApiError(
      "Set OPENAI_API_KEY and OPENAI_MODEL in .env, then restart the dev server.",
      503,
    );
  }

  // Configure transport only; no direct responses.create calls.
  const client = new OpenAI({ apiKey, maxRetries: 0 });
  const runner = new Runner({
    modelProvider: new OpenAIProvider({ openAIClient: client, useResponses: true }),
    tracingDisabled: true, // Do not export conversation data through SDK tracing by default.
  });
  const agent = new Agent({
    name: "Multimodal Agent",
    instructions: options.instructions,
    model,
    modelSettings: { maxTokens: options.maxOutputTokens, store: false, retry: { maxRetries: 0 } },
  });
  const cancellation = new AbortController();
  try {
    const input = options.messages.map((message) =>
      message.role === "user" ? user(message.content) : assistant(message.content),
    );
    const result = await runner.run(agent, input, {
      stream: true,
      signal: AbortSignal.any([signal, cancellation.signal]),
      maxTurns: 1, // Single agent turn until retrieval tools are explicitly introduced.
    });

    async function* events(): AsyncGenerator<ChatEventDto, void> {
      let completed = false;
      try {
        for await (const event of result) {
          if (event.type === "raw_model_stream_event" && event.data.type === "output_text_delta") {
            yield { type: "delta", text: event.data.delta };
          } else if (
            event.type === "raw_model_stream_event" &&
            event.data.type === "response_done"
          ) {
            completed = true;
          } else if (
            isOpenAIResponsesRawModelStreamEvent(event) &&
            event.data.event.type === "response.refusal.delta"
          ) {
            yield { type: "delta", text: event.data.event.delta };
          }
        }
        // Text ending is not proof of successful agent completion.
        await result.completed;
        if (!completed || result.cancelled) throw new Error("Agent response did not complete");
        yield { type: "done" };
      } finally {
        cancellation.abort();
        await result.completed.catch(() => {});
      }
    }

    const iterator = events();
    // Agent runs start asynchronously. Prime the stream so startup failures still get HTTP errors.
    const first = await iterator.next();
    return (async function* (): AsyncGenerator<ChatEventDto, void> {
      try {
        if (!first.done) yield first.value;
        yield* iterator;
      } finally {
        cancellation.abort();
        await iterator.return();
      }
    })();
  } catch (error) {
    cancellation.abort();
    throw providerError(error);
  }
}
