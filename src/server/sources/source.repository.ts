import "server-only";
import type { SourceDto, SourceStatus } from "../../dto/source.dto";
import { ApiError } from "../../lib/api-error";
import { getSupabaseClient } from "../supabase/client";

const SOURCE_COLUMNS = "id,filename,mime_type,storage_path,status,embedding_model,created_at";

export async function createSource(filename: string, mimeType: string): Promise<SourceDto> {
  const id = crypto.randomUUID();
  const { data, error } = await getSupabaseClient()
    .from("sources")
    .insert({ id, filename, mime_type: mimeType, storage_path: `${id}/original` })
    .select(SOURCE_COLUMNS)
    .single<SourceDto>();
  if (error) throw new ApiError("Could not save source metadata.", 502);
  return data;
}

export async function findSource(id: string): Promise<SourceDto | null> {
  const { data, error } = await getSupabaseClient()
    .from("sources")
    .select(SOURCE_COLUMNS)
    .eq("id", id)
    .maybeSingle<SourceDto>();
  if (error) throw new ApiError("Could not read source metadata.", 502);
  return data;
}

export async function updateSourceStatus(id: string, status: SourceStatus): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("sources")
    .update({ status })
    .eq("id", id)
    .select("id")
    .single();
  if (error) throw new ApiError("Could not update source status.", 502);
}

export async function deleteSourceRows(id: string): Promise<void> {
  const { error } = await getSupabaseClient().from("sources").delete().eq("id", id);
  if (error) throw new ApiError("Could not delete source metadata.", 502);
  // Database ON DELETE CASCADE removes its chunks, not its Storage object.
}

export async function uploadOriginal(source: SourceDto, file: Blob): Promise<void> {
  const { error } = await getSupabaseClient()
    .storage.from("sources")
    .upload(source.storage_path, file, { contentType: source.mime_type, upsert: false });
  if (error) throw new ApiError("Could not upload original file to private sources bucket.", 502);
}

export async function deleteOriginal(storagePath: string): Promise<void> {
  const { error } = await getSupabaseClient().storage.from("sources").remove([storagePath]);
  if (error)
    throw new ApiError(
      "Could not delete original file. Source metadata was retained for retry.",
      502,
    );
}
