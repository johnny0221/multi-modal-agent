import "server-only";
import type { SourceDto } from "../../dto/source.dto";
import { ApiError } from "../../lib/api-error";
import {
  createSource,
  findSource,
  deleteSourceRows,
  uploadOriginal,
  deleteOriginal,
} from "./source.repository";

// ponytail: server-buffered Blob for setup checks; use direct/resumable uploads for large files.
export async function storeSource(filename: string, file: Blob): Promise<SourceDto> {
  if (!filename.trim() || filename.length > 512 || file.size === 0) {
    throw new ApiError("Provide a filename (1–512 characters) and a nonempty file.");
  }
  const source = await createSource(filename, file.type || "application/octet-stream");
  try {
    await uploadOriginal(source, file);
    return source;
  } catch (error) {
    try {
      // A network failure can be ambiguous: remove any uploaded object before its metadata.
      await deleteSource(source.id);
    } catch {
      throw new ApiError(`Upload failed and cleanup needs retry for source ${source.id}.`, 502);
    }
    throw error;
  }
}

export async function deleteSource(id: string): Promise<void> {
  const source = await findSource(id);
  if (!source) return;
  // Storage + Postgres are not one transaction. Keep metadata if Storage removal fails.
  await deleteOriginal(source.storage_path);
  await deleteSourceRows(id);
}
