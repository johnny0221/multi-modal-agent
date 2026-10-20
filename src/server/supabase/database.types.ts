import type { ChunkMatchDto, SourceChunkInputDto, SourceDto } from "../../dto/source.dto";

// App-owned schema from our migration; excludes unrelated tables in an existing project.
// pgvector travels through PostgREST as a vector literal string, not a JS number array.
type StoredChunk = Omit<SourceChunkInputDto, "embedding"> & {
  id: string;
  source_id: string;
  embedding: string;
};

export type Database = {
  public: {
    Tables: {
      sources: {
        Row: SourceDto;
        Insert: Pick<SourceDto, "filename" | "mime_type" | "storage_path"> & Partial<SourceDto>;
        Update: Partial<SourceDto>;
        Relationships: [];
      };
      source_chunks: {
        Row: StoredChunk;
        Insert: Omit<StoredChunk, "id"> & { id?: string };
        Update: Partial<StoredChunk>;
        Relationships: [
          {
            foreignKeyName: "source_chunks_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "sources";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      match_source_chunks: {
        Args: { p_query_embedding: string; p_source_ids: string[]; p_limit?: number };
        Returns: ChunkMatchDto[];
      };
    };
  };
};
