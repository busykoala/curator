import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { config } from "@/config";
import { db } from "../db/client";
import { provisionUser } from "../auth/navidrome";
import {
  createPlaylist,
  getPlaylist,
  updatePlaylist,
  dashboardData,
} from "./repository";
import { savePlaylistPreview } from "./generate";
const directory = mkdtempSync(join(tmpdir(), "curator-preview-"));
config.DATABASE_PATH = join(directory, "test.sqlite");
const database = db();
const user = provisionUser({
  token: "test-only",
  navidromeUserId: "one",
  username: "one",
  displayName: "One",
});
for (const id of [1, 2])
  database
    .prepare(
      "INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES (?,?,'album','Artist','Album','flac',?,1,1,1,?,'{}','{}','written')",
    )
    .run(
      id,
      `/music/song-${id}.flac`,
      id,
      JSON.stringify({ title: [`Song ${id}`] }),
    );
const playlist = createPlaylist({
  name: "Reviewed mix",
  category: "mood",
  ownerUserId: user.id,
  config: { targetTracks: 2 },
});
const run = database
  .prepare(
    "INSERT INTO playlist_runs(playlist_id,status,preview,config_hash) VALUES (?,'complete',1,?) RETURNING id",
  )
  .get(
    playlist.id,
    createHash("sha256").update(JSON.stringify(playlist)).digest("hex"),
  ) as { id: number };
for (const [position, id] of [2, 1].entries())
  database
    .prepare(
      "INSERT INTO playlist_items(run_id,playlist_id,file_id,position,score,reason) VALUES (?,?,?,?,1,'Reviewed')",
    )
    .run(run.id, playlist.id, id, position);
test("explicit save preserves the exact reviewed order; stale and foreign preview IDs do not write native playlists", async () => {
  const original = globalThis.fetch;
  let nativeIds: string[] = [],
    writes = 0;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url)),
      path = u.pathname;
    if (
      path.endsWith("/Items") &&
      u.searchParams.get("IncludeItemTypes") === "Audio"
    ) {
      const title = u.searchParams.get("SearchTerm")!;
      return Response.json({
        Items: [
          {
            Id: "native-" + title,
            Name: title,
            Album: "Album",
            Artists: ["Artist"],
            Path: "/music/song-" + title.split(" ")[1] + ".flac",
          },
        ],
      });
    }
    if (
      path.endsWith("/Items") &&
      u.searchParams.get("IncludeItemTypes") === "Playlist"
    )
      return Response.json({
        Items: nativeIds.length
          ? [{ Id: "native-playlist", Name: playlist.name }]
          : [],
      });
    if (path.endsWith("/Playlists/native-playlist/Items"))
      return Response.json({ Items: nativeIds.map((Id) => ({ Id })) });
    if (init?.method === "POST" && path.endsWith("/Playlists")) {
      writes++;
      nativeIds = JSON.parse(String(init.body)).Ids;
      return Response.json({ Id: "native-playlist" });
    }
    throw new Error("Unexpected request " + path);
  };
  try {
    await savePlaylistPreview(playlist.id, run.id);
    assert.deepEqual(nativeIds, ["native-Song 2", "native-Song 1"]);
    assert.equal(
      getPlaylist(playlist.id)?.navidromePlaylistId,
      "native-playlist",
    );
    assert.equal(writes, 1);
    updatePlaylist(playlist.id, { intent: "Changed settings" });
    await assert.rejects(
      savePlaylistPreview(playlist.id, run.id),
      /settings changed/,
    );
    await assert.rejects(
      savePlaylistPreview(playlist.id, 999),
      /settings changed/,
    );
    assert.equal(writes, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test("unread replies are durable and scoped to the owner", () => {
  const other = provisionUser({
      token: "test-only",
      navidromeUserId: "two",
      username: "two",
      displayName: "Two",
    }),
    chat = createPlaylist({
      name: "Private chat",
      category: "chat",
      config: { targetTracks: 2 },
      ownerUserId: user.id,
    });
  database
    .prepare(
      "INSERT INTO playlist_chat_state(playlist_id,revision) VALUES (?,2)",
    )
    .run(chat.id);
  assert.equal(
    dashboardData(user.id).definitions.find((p) => p.id === chat.id)
      ?.unreadReply,
    true,
  );
  assert.ok(!dashboardData(other.id).definitions.some((p) => p.id === chat.id));
  database
    .prepare(
      "UPDATE playlist_chat_state SET read_revision=revision WHERE playlist_id=?",
    )
    .run(chat.id);
  assert.equal(
    dashboardData(user.id).definitions.find((p) => p.id === chat.id)
      ?.unreadReply,
    false,
  );
});
test.after(() => {
  database.close();
  delete (globalThis as { curatorDb?: unknown }).curatorDb;
  rmSync(directory, { recursive: true, force: true });
});
