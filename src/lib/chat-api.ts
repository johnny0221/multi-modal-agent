import axios from "axios";
import { ChatErrorSchema, type ChatRequestDto } from "../dto/chat.dto";
import { readChatStream } from "./chat-stream";

// Axios's fetch adapter supports browser ReadableStreams; XHR would buffer the response.
const api = axios.create({ adapter: "fetch", responseType: "stream" });

export async function streamChat({
  request,
  signal,
  onDelta,
}: {
  request: ChatRequestDto;
  signal: AbortSignal;
  onDelta: (delta: string) => void;
}): Promise<void> {
  const response = await api.post<ReadableStream<Uint8Array>>("/api/chat", request, {
    signal,
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) {
    // With responseType=stream, even JSON error responses arrive as a stream.
    const data: unknown = await new Response(response.data).json().catch(() => null);
    const error = ChatErrorSchema.safeParse(data);
    throw new Error(error.success ? error.data.error : "Chat request failed. Please retry.");
  }
  if (!response.data) throw new Error("The server returned an empty response.");
  for await (const delta of readChatStream(response.data)) onDelta(delta);
}
