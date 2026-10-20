import { z } from "zod";
import { ApiError } from "../lib/api-error";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

export type SourceStatus = "uploaded" | "processing" | "ready" | "failed";

export type SourceDto = {
  id: string;
  filename: string;
  mime_type: string;
  storage_path: string;
  status: SourceStatus;
  embedding_model: typeof EMBEDDING_MODEL;
  created_at: string;
};

export type SourceChunkInputDto = {
  chunk_index: number;
  content: string;
  page_start: number | null;
  page_end: number | null;
  embedding: number[];
};

export type ChunkMatchDto = Omit<SourceChunkInputDto, "embedding"> & {
  id: string;
  source_id: string;
  similarity: number;
};

export const EmbeddingSchema = z
  .array(z.number())
  .length(EMBEDDING_DIMENSIONS)
  .refine((embedding) => embedding.some((value) => value !== 0), "Embedding cannot be zero.");

// Zod rejects NaN, Infinity, holes, and wrong dimensions; SQL remains the final backstop.
export function validateEmbedding(embedding: number[]): void {
  if (!EmbeddingSchema.safeParse(embedding).success) {
    throw new ApiError(
      `Embedding must contain ${EMBEDDING_DIMENSIONS} finite numbers and cannot be zero.`,
    );
  }
}
