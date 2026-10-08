import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "@/config";
import { db, stateSet } from "../db/client";
import { schemaSql } from "../db/schema";
import {
  createPlaylist,
  dashboardData,
  getPlaylist,
  listPlaylists,
  removePlaylist,
  updatePlaylist,
} from "./repository";
import { playlistSuggestions } from "./clusters";
import { runPlaylistSchedule } from "./schedule";
import { homeData } from "../home/query";
import { defaultConfig, playlistCategories } from "./types";

const directory = mkdtempSync(join(tmpdir(), "curator-playlist-lifecycle-"));
config.DATABASE_PATH = join(directory, "test.sqlite");
const old = new Database(config.DATABASE_PATH);
old.exec(schemaSql);
old.exec(`ALTER TABLE smart_playlists ADD COLUMN owner_user_id INTEGER;
  ALTER TABLE smart_playlists ADD COLUMN automatic INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE listening_clusters ADD COLUMN user_id INTEGER;
  ALTER TABLE playlist_feedback ADD COLUMN owner_user_id INTEGER;
  CREATE TABLE music_requests(id INTEGER PRIMARY KEY,requester_user_id INTEGER,artist TEXT,album TEXT,status TEXT,updated_at TEXT);
  INSERT INTO schema_migrations(version) VALUES (2),(3),(4),(5),(6),(7),(8),(9);
  INSERT INTO curator_users(id,navidrome_user_id,username,display_name) VALUES (1,'one','one','One'),(2,'two','two','Two');
  INSERT INTO listening_clusters(id,label,terms_json,user_id) VALUES ('jazz-cluster','Jazz','["jazz"]',1),('rock-cluster','Rock','["rock"]',2);
  INSERT INTO smart_playlists(id,name,category,enabled,owner_user_id,automatic,navidrome_playlist_id) VALUES
    (1,'Jazz Deep Dive','depth',1,1,1,'native-jazz'),(2,'Forgotten Favorites','rediscovery',0,1,1,'native-favorites'),(3,'Unused pick','depth',1,2,1,NULL);
  INSERT INTO playlist_runs(playlist_id,status,config_hash) VALUES (1,'complete','hash');
  INSERT INTO playlist_feedback(playlist_id,artist,action) VALUES (1,'An artist','artist_exclude');`);
const columns =
  "id,name,category,enabled,owner_user_id,intent,config_json,navidrome_playlist_id,last_run_at,next_run_at,created_at,updated_at";
const before = old
  .prepare(`SELECT ${columns} FROM smart_playlists ORDER BY id`)
  .all();
old.close();
const database = db();
for (const id of [1, 2])
  stateSet(`listening_clusters_refreshed_v2:${id}`, new Date().toISOString());
const localDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
stateSet("playlist_research_date", localDate);
stateSet("playlist_run_date", localDate);

test("unifying deployed picks preserves all existing mixes, settings, links and history", () => {
  assert.deepEqual(
    database
      .prepare(`SELECT ${columns} FROM smart_playlists ORDER BY id`)
      .all(),
    before,
  );
  assert.equal(
    (
      database
        .prepare("SELECT count(*) n FROM smart_playlists WHERE automatic=1")
        .get() as { n: number }
    ).n,
    0,
  );
  assert.equal(
    (
      database
        .prepare("SELECT count(*) n FROM playlist_runs WHERE playlist_id=1")
        .get() as { n: number }
    ).n,
    1,
  );
  assert.equal(
    (
      database
        .prepare("SELECT count(*) n FROM playlist_feedback WHERE playlist_id=1")
        .get() as { n: number }
    ).n,
    1,
  );
  assert.ok(getPlaylist(3));
  assert.equal(Object.hasOwn(getPlaylist(1)!, "automatic"), false);
});

test("page reads, ideas and scheduled refreshes never create or remove playlists", async () => {
  const stableColumns = columns.replace(",next_run_at", "");
  const snapshot = database
    .prepare(`SELECT ${stableColumns} FROM smart_playlists ORDER BY id`)
    .all();
  for (let i = 0; i < 2; i++) {
    dashboardData(1);
    homeData(1);
    const ideas = await playlistSuggestions(1);
    assert.ok(ideas.suggestions.some((item) => item.name === "Jazz Deep Dive"));
    assert.ok(
      !ideas.suggestions.some((item) => String(item.name).includes("Rock")),
    );
    assert.ok(ideas.suggestions.every((item) => item.enabled === false));
    await runPlaylistSchedule();
  }
  assert.deepEqual(
    database
      .prepare(`SELECT ${stableColumns} FROM smart_playlists ORDER BY id`)
      .all(),
    snapshot,
  );
});

test("all playlist types are explicitly created with nightly refresh off by default", () => {
  for (const category of playlistCategories) {
    const playlist = createPlaylist({
      name: `My ${category}`,
      category,
      ownerUserId: 1,
      config: defaultConfig(category),
    });
    assert.equal(playlist.enabled, false);
    assert.equal(playlist.category, category);
    assert.equal(
      playlist.config.targetTracks,
      defaultConfig(category).targetTracks,
    );
    assert.ok(listPlaylists(1).some((item) => item.id === playlist.id));
    assert.ok(!listPlaylists(2).some((item) => item.id === playlist.id));
  }
});

test("previous picks have the same editing and refresh behavior without losing native identity", () => {
  const edited = updatePlaylist(1, {
    name: "My late jazz",
    config: { targetTracks: 12 },
  });
  assert.equal(edited.navidromePlaylistId, "native-jazz");
  assert.equal(edited.config.targetTracks, 12);
  assert.equal(edited.enabled, true);
  assert.equal(updatePlaylist(1, { enabled: false }).enabled, false);
  assert.equal(updatePlaylist(1, { enabled: true }).enabled, true);
  assert.equal(getPlaylist(1)?.navidromePlaylistId, "native-jazz");
});

test("removing a previous pick remains removed when revisiting ideas or running the scheduler", async () => {
  removePlaylist(2);
  await playlistSuggestions(1);
  dashboardData(1);
  homeData(1);
  await runPlaylistSchedule();
  assert.equal(getPlaylist(2), undefined);
  assert.ok(
    !listPlaylists(1).some((item) => item.name === "Forgotten Favorites"),
  );
});

test.after(() => {
  database.close();
  delete (globalThis as { curatorDb?: Database.Database }).curatorDb;
  rmSync(directory, { recursive: true, force: true });
});
