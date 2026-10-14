import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("adding a new single uses bounded lookups, waits for its catalogue, and monitors only the selected release", async () => {
  const directory = mkdtempSync(join(tmpdir(), "curator-music-add-"));
  process.env.CURATOR_DB_PATH = join(directory, "test.sqlite");
  const { db } = await import("../db/client");
  const { addMusic } = await import("./music");
  const fetchBefore = globalThis.fetch;
  const artist = { id: 7, artistName: "Bleu Soleil", foreignArtistId: "736ee88d-6b6d-4160-9484-a2c9ea5d3c04", monitored: true };
  const release = { id: 91, title: "Soleil bleu", foreignAlbumId: "fffd29d5-20f0-41f1-ac95-e46f6d59c64f", albumType: "Single", secondaryTypes: [], artist, monitored: false, statistics: { trackCount: 1 } };
  let catalogueReads = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)), path = url.pathname.replace("/api/v1", "");
    const reply = (value: unknown) => Response.json(value);
    if (path === "/artist" && !init?.method) {
      assert.equal(url.searchParams.get("mbId"), artist.foreignArtistId);
      return reply([]);
    }
    if (path === "/album/lookup") return reply([release]);
    if (path === "/artist/lookup") return reply([artist]);
    if (path === "/rootfolder") return reply([{ path: "/data/library", defaultQualityProfileId: 1, defaultMetadataProfileId: 1 }]);
    if (path === "/qualityprofile") return reply([{ id: 1 }]);
    if (path === "/metadataprofile") return reply([false, true].map((allowed, index) => ({ id: index + 1, primaryAlbumTypes: [{ albumType: { name: "Single" }, allowed }], secondaryAlbumTypes: [{ albumType: { name: "Studio" }, allowed: true }] })));
    if (path === "/artist" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      assert.equal(body.metadataProfileId, 2);
      assert.equal(body.qualityProfileId, 1);
      assert.equal(body.monitorNewItems, "none");
      assert.deepEqual(body.addOptions, { monitor: "none", searchForMissingAlbums: false });
      return reply(artist);
    }
    if (path === "/album") return reply(++catalogueReads === 1 ? [] : [release]);
    if (path === "/album/91") {
      if (init?.method === "PUT") release.monitored = JSON.parse(String(init.body)).monitored;
      return reply(release);
    }
    if (path === "/artist/7") return reply(artist);
    throw new Error(`Unexpected request: ${path}`);
  };
  try {
    const result = await addMusic(artist.foreignArtistId, [release.foreignAlbumId]);
    assert.deepEqual(result.albumIds, [91]);
    assert.equal(result.selectedAlbums, 1);
    assert.equal(release.monitored, true);
    assert.equal(catalogueReads, 2);
    assert.equal((db().prepare("SELECT origin FROM acquisition_targets WHERE lidarr_album_id=91").get() as {origin:string}).origin, "user");
  } finally {
    globalThis.fetch = fetchBefore;
    db().close(); delete (globalThis as {curatorDb?:unknown}).curatorDb;
    rmSync(directory, { recursive: true, force: true });
  }
});
