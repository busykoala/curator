import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "@/config";
import { db } from "../db/client";
import { browseLibrary, libraryEntity, libraryFilterOptions } from "./browse";
const directory = mkdtempSync(join(tmpdir(), "curator-browse-"));
config.DATABASE_PATH = join(directory, "test.sqlite");
const database = db();
for (let id = 1; id <= 30; id++)
  database
    .prepare(
      "INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES (?,?,?,'Artist',?,'flac',?,1,1,1,?,'{}','{}','written')",
    )
    .run(
      id,
      "/music/song-" + id + ".flac",
      "album-" + id,
      "Album " + id,
      id,
      JSON.stringify({
        title: ["Song " + id],
        genre: id % 2 ? ["Jazz"] : "Rock",
        date: ["1995"],
        composer: ["Composer"],
        label: "Label",
      }),
    );
test("search returns complete, paginated matches and keeps entity identities", async () => {
  const one = await browseLibrary("albums", "Artist", 1, 12),
    two = await browseLibrary("albums", "Artist", 2, 12);
  assert.equal(one.total, 30);
  assert.equal(two.total, 30);
  assert.equal(one.items.length, 12);
  assert.equal(two.items.length, 12);
  assert.equal(
    new Set([...one.items, ...two.items].map((i) => i.key)).size,
    24,
  );
  const entity = await libraryEntity("songs", "1");
  const track = entity?.tracks[0];
  assert.ok(track && "albumKey" in track);
  assert.equal(track.albumKey, "album-1");
});
test("filters accept array and scalar tags across collection views", async () => {
  assert.equal(
    (
      await browseLibrary("albums", "", 1, 48, {
        genre: "Jazz",
        year: "1995",
        composer: "Composer",
        label: "Label",
      })
    ).total,
    15,
  );
  assert.equal(
    (await browseLibrary("songs", "", 1, 48, { genre: "Rock" })).total,
    15,
  );
  assert.equal(
    (await browseLibrary("artists", "Artist", 1, 48, { genre: "Jazz" })).total,
    1,
  );
  assert.deepEqual(libraryFilterOptions().genres, ["Jazz", "Rock"]);
});
test.after(() => {
  database.close();
  delete (globalThis as { curatorDb?: unknown }).curatorDb;
  rmSync(directory, { recursive: true, force: true });
});
