import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "@/config";
import { schemaSql } from "./schema";
const globalDb = globalThis as typeof globalThis & { curatorDb?: Database.Database };
function tableColumns(instance: Database.Database, table: string) { return new Set((instance.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name)); }
function addColumns(instance: Database.Database, table: string, additions: ReadonlyArray<readonly [string, string]>) { const existing = tableColumns(instance, table); for (const [name, type] of additions) if (!existing.has(name)) instance.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`); }
function migrate(instance: Database.Database) {
  const applied = new Set((instance.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((row) => row.version));
  const migration = (version: number, run: () => void) => { if (applied.has(version)) return; instance.transaction(() => { run(); instance.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(version); })(); };
  migration(3, () => {
    addColumns(instance, "smart_playlists", [["owner_user_id", "INTEGER REFERENCES curator_users(id)"]]);
    addColumns(instance, "playlist_runs", [["owner_user_id", "INTEGER REFERENCES curator_users(id)"]]);
    addColumns(instance, "listening_clusters", [["user_id", "INTEGER REFERENCES curator_users(id)"]]);
    addColumns(instance, "navidrome_track_map", [["jellyfin_song_id", "TEXT"]]);
    instance.exec("DROP INDEX IF EXISTS smart_playlists_name");
    instance.exec("CREATE UNIQUE INDEX IF NOT EXISTS smart_playlists_owner_name ON smart_playlists(coalesce(owner_user_id,0),lower(name))");
    instance.exec("CREATE INDEX IF NOT EXISTS smart_playlists_owner ON smart_playlists(owner_user_id,enabled)");
    instance.exec("CREATE INDEX IF NOT EXISTS listening_clusters_user ON listening_clusters(user_id,weight DESC)");
    instance.exec("CREATE TABLE IF NOT EXISTS music_requests(id INTEGER PRIMARY KEY,requester_user_id INTEGER NOT NULL REFERENCES curator_users(id) ON DELETE CASCADE,foreign_artist_id TEXT NOT NULL,foreign_album_id TEXT NOT NULL,lidarr_artist_id INTEGER,lidarr_album_id INTEGER,artist TEXT NOT NULL DEFAULT '',album TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'queued',detail_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(requester_user_id,foreign_album_id))");
    instance.exec("CREATE INDEX IF NOT EXISTS music_requests_user ON music_requests(requester_user_id,updated_at DESC)");
  });
  migration(4, () => {
    instance.exec("CREATE VIRTUAL TABLE IF NOT EXISTS files_search USING fts5(file_id UNINDEXED,title,artist,album,tags,tokenize='unicode61 remove_diacritics 2')");
    instance.exec("DELETE FROM files_search");
    instance.exec("INSERT INTO files_search(file_id,title,artist,album,tags) SELECT id,CASE WHEN json_valid(tags_json) THEN coalesce(json_extract(tags_json,'$.title'),'') ELSE '' END,artist_name,album_name,tags_json FROM files");
    instance.exec("CREATE TRIGGER IF NOT EXISTS files_search_insert AFTER INSERT ON files BEGIN INSERT INTO files_search(file_id,title,artist,album,tags) VALUES(new.id,CASE WHEN json_valid(new.tags_json) THEN coalesce(json_extract(new.tags_json,'$.title'),'') ELSE '' END,new.artist_name,new.album_name,new.tags_json); END");
    instance.exec("CREATE TRIGGER IF NOT EXISTS files_search_delete AFTER DELETE ON files BEGIN DELETE FROM files_search WHERE file_id=old.id; END");
    instance.exec("CREATE TRIGGER IF NOT EXISTS files_search_update AFTER UPDATE OF tags_json,artist_name,album_name ON files BEGIN DELETE FROM files_search WHERE file_id=old.id; INSERT INTO files_search(file_id,title,artist,album,tags) VALUES(new.id,CASE WHEN json_valid(new.tags_json) THEN coalesce(json_extract(new.tags_json,'$.title'),'') ELSE '' END,new.artist_name,new.album_name,new.tags_json); END");
  });
  migration(5, () => {
    instance.exec("DROP INDEX IF EXISTS smart_playlists_name");
    instance.exec("CREATE UNIQUE INDEX IF NOT EXISTS smart_playlists_owner_name ON smart_playlists(coalesce(owner_user_id,0),lower(name))");
  });
}
export function db(): Database.Database {
  if (globalDb.curatorDb) return globalDb.curatorDb;
  mkdirSync(dirname(config.DATABASE_PATH), { recursive: true }); const instance = new Database(config.DATABASE_PATH);
  instance.pragma("journal_mode = WAL"); instance.pragma("synchronous = NORMAL"); instance.pragma("foreign_keys = ON"); instance.pragma("busy_timeout = 2000");
  instance.exec(schemaSql);
  const jobColumns = new Set((instance.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>).map((row) => row.name));
  for (const [name, type] of [["heartbeat_at","TEXT"],["progress_json","TEXT DEFAULT '{}'"],["error_detail","TEXT"]] as const) if (!jobColumns.has(name)) instance.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
  const discovery = new Set((instance.prepare("PRAGMA table_info(discovery_candidates)").all() as Array<{ name: string }>).map((row) => row.name));
  for (const [name,type] of [["lidarr_artist_id","INTEGER"],["lidarr_album_id","INTEGER"],["queued_at","TEXT"],["last_search_at","TEXT"],["last_checked_at","TEXT"],["last_progress_at","TEXT"],["last_size_left","INTEGER"],["search_attempts","INTEGER NOT NULL DEFAULT 0"],["cooldown_until","TEXT"],["imported_at","TEXT"]] as const) if(!discovery.has(name))instance.exec(`ALTER TABLE discovery_candidates ADD COLUMN ${name} ${type}`);
  instance.prepare("INSERT OR IGNORE INTO schema_migrations(version) VALUES (2)").run(); migrate(instance); globalDb.curatorDb = instance; return instance;
}
export function stateGet(key: string, fallback = ""): string { return (db().prepare("SELECT value FROM state WHERE key=?").get(key) as { value: string } | undefined)?.value ?? fallback; }
export function stateSet(key: string, value: string): void { db().prepare("INSERT INTO state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP").run(key, value); }
