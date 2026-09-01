import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "@/config";
import { schemaSql } from "./schema";
const globalDb = globalThis as typeof globalThis & { curatorDb?: Database.Database };
export function db(): Database.Database {
  if (globalDb.curatorDb) return globalDb.curatorDb;
  mkdirSync(dirname(config.DATABASE_PATH), { recursive: true }); const instance = new Database(config.DATABASE_PATH);
  instance.pragma("journal_mode = WAL"); instance.pragma("synchronous = NORMAL"); instance.pragma("foreign_keys = ON"); instance.pragma("busy_timeout = 2000");
  instance.exec(schemaSql);
  const columns = new Set((instance.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>).map((row) => row.name));
  for (const [name, type] of [["heartbeat_at","TEXT"],["progress_json","TEXT DEFAULT '{}'"],["error_detail","TEXT"]] as const) if (!columns.has(name)) instance.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
  const discovery = new Set((instance.prepare("PRAGMA table_info(discovery_candidates)").all() as Array<{ name: string }>).map((row) => row.name));
  for (const [name,type] of [["lidarr_artist_id","INTEGER"],["lidarr_album_id","INTEGER"],["queued_at","TEXT"],["last_search_at","TEXT"],["last_checked_at","TEXT"],["last_progress_at","TEXT"],["last_size_left","INTEGER"],["search_attempts","INTEGER NOT NULL DEFAULT 0"],["cooldown_until","TEXT"],["imported_at","TEXT"]] as const) if(!discovery.has(name))instance.exec(`ALTER TABLE discovery_candidates ADD COLUMN ${name} ${type}`);
  instance.prepare("INSERT OR IGNORE INTO schema_migrations(version) VALUES (2)").run(); globalDb.curatorDb = instance; return instance;
}
export function stateGet(key: string, fallback = ""): string { return (db().prepare("SELECT value FROM state WHERE key=?").get(key) as { value: string } | undefined)?.value ?? fallback; }
export function stateSet(key: string, value: string): void { db().prepare("INSERT INTO state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP").run(key, value); }
