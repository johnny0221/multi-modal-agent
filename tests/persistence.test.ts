import { afterEach, expect, test, vi } from "vite-plus/test";
import { EMBEDDING_DIMENSIONS, validateEmbedding } from "../src/dto/source.dto";
import { getSupabaseClient } from "../src/server/supabase/client";
import { insertChunks, matchChunks } from "../src/server/sources/chunk.repository";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function vector() {
  const result = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  result[0] = 1;
  return result;
}

test("vectors must be nonzero, finite, dense and exactly 1536-dimensional", () => {
  expect(() => validateEmbedding(vector())).not.toThrow();
  const sparse = vector();
  Reflect.deleteProperty(sparse, "1");
  for (const value of [
    [],
    [1, 0],
    Array<number>(EMBEDDING_DIMENSIONS).fill(0),
    sparse,
    vector().map((v, index) => (index === 1 ? NaN : v)),
    vector().map((v, index) => (index === 1 ? Infinity : v)),
  ]) {
    expect(() => validateEmbedding(value)).toThrow();
  }
});

test("missing Supabase config fails without including credentials", () => {
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SECRET_KEY", "private-test-key");
  expect(() => getSupabaseClient()).toThrow("Set SUPABASE_URL and SUPABASE_SECRET_KEY");
});

test("invalid or publishable keys fail locally before any network request", () => {
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  for (const key of ["password-like-test-value", "sb_publishable_test-only"]) {
    vi.stubEnv("SUPABASE_SECRET_KEY", key);
    expect(() => getSupabaseClient()).toThrow("must be a Supabase server secret");
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

test("retrieval is scoped, serializes vector and uses only server Supabase credentials", async () => {
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test-only");
  const fetchMock = vi.fn(() => Promise.resolve(Response.json([])));
  vi.stubGlobal("fetch", fetchMock);
  const ids = ["00000000-0000-4000-8000-000000000001"];
  expect(await matchChunks(vector(), ids, 3)).toEqual([]);
  const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://example.supabase.co/rest/v1/rpc/match_source_chunks");
  const payload = JSON.parse(options.body as string);
  expect(payload.p_source_ids).toEqual(ids);
  expect(payload.p_limit).toBe(3);
  expect(JSON.parse(payload.p_query_embedding)).toEqual(vector());
  expect(new Headers(options.headers).get("apikey")).toBe("sb_secret_test-only");
});

test("unscoped search and invalid chunks fail before network calls", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await expect(matchChunks(vector(), [])).rejects.toThrow("Select 1–20 sources");
  await expect(matchChunks(vector(), ["id"], 21)).rejects.toThrow();
  await expect(insertChunks("id", [])).rejects.toThrow("at least one chunk");
  expect(fetchMock).not.toHaveBeenCalled();
});
