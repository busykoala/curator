import assert from "node:assert/strict";
import test from "node:test";
import { searchMusicCatalogue } from "./music-search";

const artist = { artistName: "Bleu Soleil", foreignArtistId: "artist-id" };
const album = { title: "Soleil bleu", foreignAlbumId: "release-id", artist };
const unavailable = async () => { throw new Error("503 upstream stack trace"); };

test("album search uses the catalogue fallback while retaining artist results", async () => {
  const result = await searchMusicCatalogue(" bleu soleil, luiza ", {
    artists: async () => [artist], albums: unavailable,
    fallbackAlbums: async term => { assert.equal(term, "bleu soleil, luiza"); return [album]; },
  });
  assert.deepEqual(result, { artists: [artist], albums: [album], warning: "" });
});

test("a failed album provider does not discard useful artist results or expose its stack", async () => {
  const result = await searchMusicCatalogue("Bleu Soleil", {
    artists: async () => [artist], albums: unavailable, fallbackAlbums: unavailable,
  });
  assert.deepEqual(result.artists, [artist]);
  assert.deepEqual(result.albums, []);
  assert.match(result.warning ?? "", /Album search is temporarily unavailable/);
  assert.doesNotMatch(JSON.stringify(result), /503|stack trace/);
});

test("album results remain usable when artist search fails", async () => {
  const result = await searchMusicCatalogue("Soleil bleu", {
    artists: unavailable, albums: async () => [album], fallbackAlbums: unavailable,
  });
  assert.deepEqual(result.albums, [album]);
  assert.match(result.warning ?? "", /Artist search is temporarily unavailable/);
});

test("a complete catalogue outage returns a clear recoverable error", async () => {
  await assert.rejects(searchMusicCatalogue("Soleil bleu", {
    artists: unavailable, albums: unavailable, fallbackAlbums: unavailable,
  }), /^Error: The music catalogue is temporarily unavailable\. Please try again shortly\.$/);
});

test("successful and empty searches do not query the fallback provider", async () => {
  let calls = 0;
  const dependencies = { artists: async () => [artist], albums: async () => [album], fallbackAlbums: async () => { calls++; return []; } };
  assert.deepEqual((await searchMusicCatalogue("Bleu Soleil", dependencies)).albums, [album]);
  assert.deepEqual(await searchMusicCatalogue(" ", dependencies), { artists: [], albums: [] });
  assert.equal(calls, 0);
});
