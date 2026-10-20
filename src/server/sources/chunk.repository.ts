import "server-only";
import {
  validateEmbedding,
  type ChunkMatchDto,
  type SourceChunkInputDto,
} from "../../dto/source.dto";
import { ApiError } from "../../lib/api-error";
import { getSupabaseClient } from "../supabase/client";

export async function insertChunks(sourceId: string, chunks: SourceChunkInputDto[]): Promise<void> {
  if (chunks.length === 0) throw new ApiError("Provide at least one chunk.");
  for (const chunk of chunks) validateEmbedding(chunk.embedding);
  const { error } = await getSupabaseClient()
    .from("source_chunks")
    .insert(
      chunks.map((chunk) => ({
        source_id: sourceId,
        chunk_index: chunk.chunk_index,
        content: chunk.content,
        page_start: chunk.page_start,
        page_end: chunk.page_end,
        embedding: JSON.stringify(chunk.embedding),
      })),
    );
  if (error)
    throw new ApiError(
      "Could not save chunks. Check source ID, chunk order, and page references.",
      502,
    );
}

export async function matchChunks(
  queryEmbedding: number[],
  sourceIds: string[],
  limit = 5,
): Promise<ChunkMatchDto[]> {
  validateEmbedding(queryEmbedding);
  if (
    sourceIds.length < 1 ||
    sourceIds.length > 20 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 20
  ) {
    throw new ApiError("Select 1–20 sources and request 1–20 matches.");
  }
  const { data, error } = await getSupabaseClient().rpc("match_source_chunks", {
    p_query_embedding: JSON.stringify(queryEmbedding),
    p_source_ids: sourceIds,
    p_limit: limit,
  });
  if (error) throw new ApiError("Could not search source chunks.", 502);
  return data ?? [];
}
