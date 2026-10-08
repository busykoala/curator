import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "@/config";
import { db } from "../db/client";
import { schemaSql } from "../db/schema";
import { createPlaylist, ensurePlaylist, getPlaylist, listPlaylists, removePlaylist, removeUnusedAutomaticPlaylists, updatePlaylist } from "./repository";
import { defaultConfig } from "./types";
import { ensureAutomaticPlaylists } from "./automatic";

const directory = mkdtempSync(join(tmpdir(), "curator-automatic-test-"));
config.DATABASE_PATH = join(directory, "test.sqlite");
const old = new Database(config.DATABASE_PATH);
old.exec(schemaSql);
old.exec(`DROP TABLE automatic_playlist_choices;
  ALTER TABLE smart_playlists ADD COLUMN owner_user_id INTEGER;
  ALTER TABLE smart_playlists ADD COLUMN automatic INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE listening_clusters ADD COLUMN user_id INTEGER;
  INSERT INTO schema_migrations(version) VALUES (2),(3),(4),(5),(6),(7);
  INSERT INTO curator_users(id,navidrome_user_id,username,display_name) VALUES (1,'one','one','One'),(2,'two','two','Two');
  INSERT INTO listening_clusters(id,label,terms_json,user_id) VALUES ('jazz-cluster','Jazz','["jazz"]',1);
  INSERT INTO smart_playlists(id,name,category,enabled,owner_user_id,automatic,navidrome_playlist_id) VALUES
    (1,'Jazz Deep Dive','depth',1,1,1,'native-jazz'),(2,'Forgotten Favorites','rediscovery',1,1,1,'native-favorites');
  INSERT INTO playlist_runs(playlist_id,status,config_hash) VALUES (1,'complete','hash');
  INSERT INTO playlist_feedback(playlist_id,artist,action) VALUES (1,'An artist','artist_exclude');`);
old.close();
const database = db();
database.prepare("INSERT INTO state(key,value) VALUES ('listening_clusters_refreshed_v2:1',?)").run(new Date().toISOString());
const pick = (name: string, ownerUserId = 1) => ({ name, category: "depth", enabled: true, ownerUserId, config: defaultConfig("depth") });
const choice = (key: string, owner = 1) => database.prepare("SELECT playlist_id FROM automatic_playlist_choices WHERE owner_user_id=? AND default_key=?").get(owner, key) as { playlist_id: number | null } | undefined;

test("existing deployed defaults bind before editing and preserve their Navidrome link and history", async () => {
  assert.equal(choice("depth:jazz-cluster")?.playlist_id, 1);
  assert.equal(choice("rediscovery:forgotten")?.playlist_id, 2);
  const customized = updatePlaylist(1, { name: "My late jazz", intent: "Gentler", config: { targetTracks: 12 } });
  assert.equal(customized.automatic, false);
  assert.equal(customized.navidromePlaylistId, "native-jazz");
  assert.equal(customized.config.targetTracks, 12);
  assert.equal(customized.enabled, true);
  assert.equal((database.prepare("SELECT count(*) n FROM playlist_runs WHERE playlist_id=1").get() as { n: number }).n, 1);
  assert.equal((database.prepare("SELECT count(*) n FROM playlist_feedback WHERE playlist_id=1").get() as { n: number }).n, 1);
  assert.equal(ensurePlaylist(pick("Jazz Deep Dive"), "depth:jazz-cluster"), false);
  assert.equal(getPlaylist(1)?.name, "My late jazz");
  assert.equal(listPlaylists(1).filter(p => p.category === "depth").length, 1);
  const reconciled = await ensureAutomaticPlaylists(1);
  assert.equal(reconciled.created, 0);
  assert.equal(reconciled.total, 1);
  assert.equal(getPlaylist(1)?.name, "My late jazz");
  assert.equal(getPlaylist(1)?.navidromePlaylistId, "native-jazz");
});

test("pause and resume preserve a Curator pick and its settings across repeated reconciliation", () => {
  ensurePlaylist(pick("Electronic Deep Dive"), "depth:electronic");
  const id = choice("depth:electronic")!.playlist_id!;
  updatePlaylist(id, { enabled: false });
  for (let i = 0; i < 3; i++) ensurePlaylist(pick("Electronic Deep Dive"), "depth:electronic");
  assert.equal(getPlaylist(id)?.automatic, true);
  assert.equal(getPlaylist(id)?.enabled, false);
  updatePlaylist(id, { enabled: true });
  assert.equal(getPlaylist(id)?.automatic, true);
  assert.equal(getPlaylist(id)?.enabled, true);
});

test("deleting an existing or customized pick remembers dismissal for only that listener", () => {
  removePlaylist(2);
  assert.equal(choice("rediscovery:forgotten")?.playlist_id, null);
  assert.equal(ensurePlaylist({ ...pick("Forgotten Favorites"), category: "rediscovery" }, "rediscovery:forgotten"), false);
  removePlaylist(1);
  assert.equal(choice("depth:jazz-cluster")?.playlist_id, null);
  assert.equal(ensurePlaylist(pick("Jazz Deep Dive"), "depth:jazz-cluster"), false);
  assert.equal(ensurePlaylist(pick("Jazz Deep Dive", 2), "depth:jazz-cluster"), true);
});

test("ownership transfer preserves the original default decision and does not resurrect a replacement", () => {
  ensurePlaylist(pick("Transferred pick"), "depth:transfer");
  const id = choice("depth:transfer")!.playlist_id!;
  updatePlaylist(id, { ownerUserId: 2 });
  assert.equal(getPlaylist(id)?.automatic, false);
  assert.equal(getPlaylist(id)?.ownerUserId, 2);
  assert.equal(ensurePlaylist(pick("Transferred pick"), "depth:transfer"), false);
});

test("matching personal playlists stay personal and names shared by another type do not break default creation", () => {
  const personal = createPlaylist(pick("Existing personal"));
  assert.equal(ensurePlaylist(pick("Existing personal"), "depth:personal"), false);
  assert.equal(getPlaylist(personal.id)?.automatic, false);
  createPlaylist({ ...pick("Shared title"), category: "mood" });
  assert.equal(ensurePlaylist(pick("Shared title"), "depth:collision"), true);
  const id = choice("depth:collision")!.playlist_id!;
  assert.equal(getPlaylist(id)?.name, "Shared title · Curator");
  removeUnusedAutomaticPlaylists(1, new Set(["depth:collision", "depth:personal", "depth:electronic"]));
  assert.ok(getPlaylist(id));
  assert.ok(getPlaylist(personal.id));
});

test("retiring unused suggestions allows a later return but preserves published and customized playlists", () => {
  ensurePlaylist(pick("Unused pick"), "depth:unused");
  const id = choice("depth:unused")!.playlist_id!;
  ensurePlaylist(pick("Customized pick"), "depth:customized");
  const customId = choice("depth:customized")!.playlist_id!;
  updatePlaylist(customId, { config: { targetTracks: 18 } });
  ensurePlaylist(pick("Published pick"), "depth:published");
  const publishedId = choice("depth:published")!.playlist_id!;
  database.prepare("UPDATE smart_playlists SET navidrome_playlist_id='native-published' WHERE id=?").run(publishedId);
  removeUnusedAutomaticPlaylists(1, new Set());
  assert.equal(getPlaylist(id), undefined);
  assert.equal(choice("depth:unused"), undefined);
  assert.equal(ensurePlaylist(pick("Unused pick"), "depth:unused"), true);
  assert.equal(getPlaylist(customId)?.config.targetTracks, 18);
  assert.ok(getPlaylist(publishedId));
  assert.equal(ensurePlaylist(pick("Customized pick"), "depth:customized"), false);
});

test.after(() => {
  database.close();
  delete (globalThis as { curatorDb?: Database.Database }).curatorDb;
  rmSync(directory, { recursive: true, force: true });
});
