import Database from "better-sqlite3";
import { analyzeAudio } from "../src/features/categorization/audio";
import { loadAlbumFiles } from "../src/features/categorization/context";

const databasePath = process.env.DATABASE_PATH ?? "/app/data/curator.sqlite";
const analyzerVersion = 3;
const concurrency = 4;
const leaseMs = 6 * 60 * 60 * 1_000;
let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
function state(database: Database.Database, key: string): string {
  return (database.prepare("SELECT value FROM state WHERE key=?").get(key) as { value?: string } | undefined)?.value ?? "";
}

async function pool<T>(items: T[], worker: (item: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!stopping) {
      const index = cursor++;
      if (index >= items.length) break;
      await worker(items[index]);
    }
  }));
}

function claim(database: Database.Database, albumKey: string) {
  const transaction = database.transaction(() => {
    database.prepare("DELETE FROM album_work_leases WHERE expires_at<=?").run(Date.now());
    return database.prepare("INSERT OR IGNORE INTO album_work_leases(album_key,purpose,expires_at) VALUES (?,?,?)")
      .run(albumKey, "audio", Date.now() + leaseMs).changes === 1;
  });
  return transaction();
}

async function main() {
  const database = new Database(databasePath);
  const keys = database.prepare(`
    SELECT DISTINCT f.album_key
    FROM files f
    LEFT JOIN audio_features a ON a.file_id=f.id AND a.analyzer_version=?
    WHERE a.file_id IS NULL
    ORDER BY f.album_key
  `).all(analyzerVersion) as Array<{ album_key: string }>;
  let analyzed = 0;
  let failed = 0;
  let albums = 0;
  console.log(JSON.stringify({ event: "audio_backfill_started", albums: keys.length, concurrency }));
  for (const { album_key: albumKey } of keys) {
    while (!stopping && state(database, "scheduler_phase") === "scan") await sleep(10_000);
    if (state(database, "paused") === "true") stopping = true;
    if (stopping) break;
    if (!claim(database, albumKey)) continue;
    try {
      const files = loadAlbumFiles(albumKey);
      await pool(files, async (file) => {
        try {
          await analyzeAudio(file);
          analyzed += 1;
        } catch (error) {
          failed += 1;
          console.error(JSON.stringify({ event: "audio_file_failed", fileId: file.id, error: String(error) }));
        }
      });
      albums += 1;
      if (albums % 10 === 0) console.log(JSON.stringify({ event: "audio_progress", albums, analyzed, failed, totalAlbums: keys.length }));
    } finally {
      database.prepare("DELETE FROM album_work_leases WHERE album_key=? AND purpose=?").run(albumKey, "audio");
    }
  }
  database.close();
  console.log(JSON.stringify({ event: "audio_backfill_stopped", albums, analyzed, failed }));
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "audio_backfill_failed", error: String(error) }));
  process.exitCode = 1;
});
