import assert from "node:assert/strict";
import { exactManualImport } from "../src/features/acquisition/manual-import";

const original = globalThis.fetch;
let albums = [42, 42];
let submitted: Record<string, unknown> | undefined;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("/manualimport?")) return Response.json(albums.map((albumId, index) => ({
    path: `/data/downloads/test/${index + 1}.flac`,
    artist: { id: 7, artistName: "Artist" },
    album: { id: albumId, title: "Album" },
    tracks: [{ id: 100 + index }],
    rejections: [],
    quality: { quality: { id: 6, name: "FLAC" } },
    albumReleaseId: 9,
  })));
  if (url.endsWith("/command") && init?.method === "POST") {
    submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
    return Response.json({ id: 1, status: "started" });
  }
  if (url.endsWith("/command/1")) return Response.json({ id: 1, status: "completed" });
  throw new Error(`Unexpected request: ${url}`);
};

async function main() { try {
  const result = await exactManualImport({ id: 1, downloadId: "hash", status: "completed" });
  assert.notEqual(result, false);
  assert.equal(result && result.albumId, 42);
  assert.equal((submitted?.files as unknown[]).length, 2);
  assert.deepEqual((submitted?.files as Array<{ albumReleaseId?: number }>).map(file => file.albumReleaseId), [9, 9]);
  albums = [42, 43];
  submitted = undefined;
  assert.equal(await exactManualImport({ id: 2, downloadId: "other" }), false);
  assert.equal(submitted, undefined);
  console.log("Manual import audit passed: unique album identities are recovered and ambiguous mappings are rejected.");
} finally {
  globalThis.fetch = original;
} }

main().catch((error) => { console.error(error); process.exitCode = 1; });
