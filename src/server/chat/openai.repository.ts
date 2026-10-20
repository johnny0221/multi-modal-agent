import "server-only";
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

// External API access only. No HTTP Request/Response or chat policy in this layer.
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

  const client = new OpenAI({ apiKey, maxRetries: 0 });
  // Open eagerly: failures before streaming must still become an HTTP error status.
  const upstream = await client.responses
    .create(
      {
        model,
        instructions: options.instructions,
        input: options.messages,
        max_output_tokens: options.maxOutputTokens,
        store: false,
        stream: true,
      },
      { signal },
    )
    .catch((error: unknown) => {
      throw providerError(error);
    });

  async function* events(): AsyncGenerator<ChatEventDto, void> {
    try {
      for await (const event of upstream) {
        if (
          event.type === "response.output_text.delta" ||
          event.type === "response.refusal.delta"
        ) {
          yield { type: "delta", text: event.delta };
        } else if (event.type === "response.completed") {
          yield { type: "done" };
          return;
        } else if (event.type === "response.incomplete") {
          throw new Error("Incomplete model response");
        } else if (event.type === "response.failed" || event.type === "error") {
          throw new Error("Provider stream failed");
        }
      }
      throw new Error("Provider stream ended early");
    } finally {
      upstream.controller.abort();
    }
  }
  return events();
}
