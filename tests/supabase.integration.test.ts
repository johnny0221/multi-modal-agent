import { expect, test, vi } from "vite-plus/test";
import { EMBEDDING_DIMENSIONS } from "../src/dto/source.dto";
import { insertChunks, matchChunks } from "../src/server/sources/chunk.repository";
import { findSource, updateSourceStatus } from "../src/server/sources/source.repository";
import { storeSource, deleteSource } from "../src/server/sources/source.service";
import { getSupabaseClient } from "../src/server/supabase/client";

vi.mock("server-only", () => ({}));

// Explicit opt-in only: creates/deletes its own tiny fixtures in your configured DEV project.
test.skipIf(process.env.RUN_SUPABASE_CHECK !== "1")(
  "Supabase private files → chunks → scoped search → cleanup",
  async () => {
    process.loadEnvFile(".env");
    const { data: bucket, error } = await getSupabaseClient().storage.getBucket("sources");
    if (error) {
      // A null data result with an error is not evidence that the bucket is missing.
      const status = error.statusCode ?? error.status ?? "unknown";
      throw new Error(
        `Could not inspect sources bucket (Storage status ${status}). Check SUPABASE_URL and server secret belong to the same project; authentication/permissions must succeed before checking bucket existence.`,
      );
    }
    if (!bucket)
      throw new Error(
        "No sources bucket returned. Check bucket ID and configured Supabase project.",
      );
    if (bucket.public) throw new Error("The sources bucket must be PRIVATE (Public OFF).");
    const embedding = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    embedding[0] = 1;
    const ids: string[] = [];
    const failures: unknown[] = [];
    try {
      const first = await storeSource(
        "persistence-check.txt",
        new Blob(["Sample source"], { type: "text/plain" }),
      );
      ids.push(first.id);
      const other = await storeSource(
        "scope-check.txt",
        new Blob(["Other source"], { type: "text/plain" }),
      );
      ids.push(other.id);

      for (const source of [first, other]) {
        await updateSourceStatus(source.id, "processing");
        await insertChunks(source.id, [
          {
            chunk_index: 0,
            content: source.id === first.id ? "Expected source" : "Other source must not leak",
            page_start: null,
            page_end: null,
            embedding,
          },
        ]);
      }
      expect(await matchChunks(embedding, [first.id])).toEqual([]);
      await updateSourceStatus(first.id, "ready");
      await updateSourceStatus(other.id, "ready");
      const matches = await matchChunks(embedding, [first.id]);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.source_id).toBe(first.id);
      expect(matches[0]?.similarity).toBeCloseTo(1);
    } catch (error) {
      failures.push(error);
    } finally {
      for (const id of ids) {
        try {
          await deleteSource(id);
        } catch {
          failures.push(new Error(`Fixture cleanup needs retry for source ID: ${id}`));
        }
      }
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        "Supabase setup check failed; inspect errors and cleanup IDs.",
      );
    for (const id of ids) expect(await findSource(id)).toBeNull();
  },
  60_000,
);
