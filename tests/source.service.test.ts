import { beforeEach, expect, test, vi } from "vite-plus/test";
import type { SourceDto } from "../src/dto/source.dto";
import * as repository from "../src/server/sources/source.repository";
import { deleteSource, storeSource } from "../src/server/sources/source.service";

vi.mock("server-only", () => ({}));
vi.mock("../src/server/sources/source.repository", () => ({
  createSource: vi.fn(),
  findSource: vi.fn(),
  deleteSourceRows: vi.fn(),
  uploadOriginal: vi.fn(),
  deleteOriginal: vi.fn(),
}));

const source: SourceDto = {
  id: "00000000-0000-4000-8000-000000000001",
  filename: "sample.txt",
  mime_type: "text/plain",
  storage_path: "00000000-0000-4000-8000-000000000001/original",
  status: "uploaded",
  embedding_model: "text-embedding-3-small",
  created_at: "2026-10-20T00:00:00Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(repository.createSource).mockResolvedValue(source);
  vi.mocked(repository.findSource).mockResolvedValue(source);
});

test("stores metadata and file, leaving ingestion status uploaded", async () => {
  expect(await storeSource("sample.txt", new Blob(["sample"], { type: "text/plain" }))).toEqual(
    source,
  );
  expect(repository.uploadOriginal).toHaveBeenCalledOnce();
});

test("failed Storage deletion retains source metadata for retry", async () => {
  vi.mocked(repository.deleteOriginal).mockRejectedValue(new Error("Storage unavailable"));
  await expect(deleteSource(source.id)).rejects.toThrow("Storage unavailable");
  expect(repository.deleteSourceRows).not.toHaveBeenCalled();
});

test("failed upload attempts object cleanup before metadata deletion", async () => {
  vi.mocked(repository.uploadOriginal).mockRejectedValue(new Error("Upload failed"));
  await expect(storeSource("sample.txt", new Blob(["sample"]))).rejects.toThrow("Upload failed");
  expect(repository.deleteOriginal).toHaveBeenCalledWith(source.storage_path);
  expect(repository.deleteSourceRows).toHaveBeenCalledWith(source.id);
  expect(vi.mocked(repository.deleteOriginal).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(repository.deleteSourceRows).mock.invocationCallOrder[0]!,
  );
});
