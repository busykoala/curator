import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { resolveIdentity } from "../src/features/identity/resolve";
import { cleanArtistName, cleanCatalogText, type MbCandidate } from "../src/features/sources/musicbrainz";

const databasePath = process.env.DATABASE_PATH ?? "/app/data/curator.sqlite";
const headers = { "User-Agent": "MusicCurator/2.0 (self-hosted; contact=local-admin)", Accept: "application/json" };
let nextRequest = 0;
let requestGate: Promise<void> = Promise.resolve();
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function musicBrainz(query: string): Promise<MbCandidate[]> {
  const turn = requestGate.then(async () => {
    const wait = Math.max(0, nextRequest - Date.now());
    if (wait) await sleep(wait);
    nextRequest = Date.now() + 1_100;
  });
  requestGate = turn.catch(() => undefined);
  await turn;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&limit=10&fmt=json`, {
      headers,
      signal: AbortSignal.timeout(20_000),
    }).catch(() => undefined);
    if (response?.ok) return ((await response.json()) as { "release-groups"?: MbCandidate[] })["release-groups"] ?? [];
    if (![429, 503].includes(response?.status ?? 0)) break;
    await sleep(5_000 * (attempt + 1));
  }
  return [];
}

async function candidates(artist: string, album: string): Promise<MbCandidate[]> {
  const cleanArtist = cleanArtistName(artist);
  const cleanAlbum = cleanCatalogText(album);
  const exact = await musicBrainz(`artist:${JSON.stringify(cleanArtist)} AND releasegroup:${JSON.stringify(cleanAlbum)}`);
  return exact.length ? exact : musicBrainz(`releasegroup:${JSON.stringify(cleanAlbum)}`);
}

function writeTags(paths: string[], artistMbid: string, releaseGroupMbid: string) {
  const options = [
    "--remove-tag=MUSICBRAINZ_ARTISTID",
    "--remove-tag=MUSICBRAINZ_ALBUMARTISTID",
    "--remove-tag=MUSICBRAINZ_RELEASEGROUPID",
    `--set-tag=MUSICBRAINZ_ARTISTID=${artistMbid}`,
    `--set-tag=MUSICBRAINZ_ALBUMARTISTID=${artistMbid}`,
    `--set-tag=MUSICBRAINZ_RELEASEGROUPID=${releaseGroupMbid}`,
  ];
  const result = spawnSync("metaflac", [...options, ...paths], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || `metaflac exited ${result.status}`);
}

async function main() {
  const database = new Database(databasePath);
  database.pragma("busy_timeout=10000");
  const albums = database.prepare(`
    SELECT i.album_key,min(f.artist_name) artist,min(f.album_name) album
    FROM issues i JOIN files f ON f.album_key=i.album_key
    WHERE i.status='open' AND i.code='identity_unresolved'
    GROUP BY i.album_key ORDER BY album DESC,artist DESC
  `).all() as Array<{ album_key: string; artist: string; album: string }>;
  const jobId = Number((database.prepare("INSERT INTO jobs(phase,status,subject,started_at,heartbeat_at) VALUES (?,'running',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id").get("identity-direct", "Reverse catalog pass") as { id: number }).id);
  const filesFor = database.prepare("SELECT id,path,format,link_count,tags_json FROM files WHERE album_key=? ORDER BY path");
  const lease = database.prepare("INSERT OR IGNORE INTO album_work_leases(album_key,purpose,expires_at) VALUES (?,?,?)");
  const release = database.prepare("DELETE FROM album_work_leases WHERE album_key=? AND purpose=?");
  let resolved = 0;
  let unmatched = 0;
  let failed = 0;
  try {
    let cursor = 0;
    await Promise.all(Array.from({ length: 4 }, async () => { while (!stopping) {
      const index = cursor++;
      if (index >= albums.length) break;
      const item = albums[index];
      if (lease.run(item.album_key, "identity-direct", Date.now() + 60 * 60_000).changes !== 1) continue;
      try {
        database.prepare("UPDATE jobs SET subject=?,progress_json=?,heartbeat_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(`${item.artist} / ${item.album}`, JSON.stringify({ processedCount: index, totalCount: albums.length, resolved, unmatched, failed }), jobId);
        const files = filesFor.all(item.album_key) as Array<{ id: number; path: string; format: string; link_count: number; tags_json: string }>;
        if (!files.length || files.some((file) => file.format.toLowerCase() !== "flac" || file.link_count !== 1)) { failed += 1; continue; }
        const found = await candidates(item.artist, item.album);
        const identity = resolveIdentity(item.artist, item.album, found, []);
        const acceptable = Boolean(identity.artistId && identity.releaseGroupId && identity.confidence >= .82 && (identity.margin >= .01 || identity.confidence >= .92));
        if (!acceptable) { unmatched += 1; continue; }
        writeTags(files.map((file) => file.path), identity.artistId!, identity.releaseGroupId!);
        const transaction = database.transaction(() => {
          const update = database.prepare("UPDATE files SET tags_json=? WHERE id=?");
          for (const file of files) {
            const tags = JSON.parse(file.tags_json) as Record<string, unknown>;
            tags.musicbrainzArtistId = [identity.artistId];
            tags.musicbrainzAlbumArtistId = [identity.artistId];
            tags.musicbrainzReleaseGroupId = [identity.releaseGroupId];
            update.run(JSON.stringify(tags), file.id);
          }
          database.prepare(`INSERT INTO manual_overrides(album_key,artist_name,album_name,release_date,artist_mbid,release_group_mbid,confirmed)
            VALUES (?,?,?,?,?,?,1) ON CONFLICT(album_key) DO UPDATE SET artist_name=excluded.artist_name,album_name=excluded.album_name,release_date=excluded.release_date,artist_mbid=excluded.artist_mbid,release_group_mbid=excluded.release_group_mbid,confirmed=1,updated_at=CURRENT_TIMESTAMP`)
            .run(item.album_key, identity.artist, identity.album, identity.date ?? null, identity.artistId, identity.releaseGroupId);
          database.prepare("UPDATE issues SET status='resolved',updated_at=CURRENT_TIMESTAMP WHERE album_key=? AND code='identity_unresolved' AND status='open'").run(item.album_key);
        });
        transaction();
        resolved += 1;
        console.log(JSON.stringify({ event: "identity_resolved", artist: item.artist, album: item.album, match: identity.album, confidence: identity.confidence, margin: identity.margin, releaseGroupMbid: identity.releaseGroupId, resolved, total: albums.length }));
      } catch (error) {
        failed += 1;
        console.error(JSON.stringify({ event: "identity_failed", artist: item.artist, album: item.album, error: String(error) }));
      } finally {
        release.run(item.album_key, "identity-direct");
      }
    }}));
    database.prepare("UPDATE jobs SET status='complete',detail=?,heartbeat_at=CURRENT_TIMESTAMP,finished_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(JSON.stringify({ resolved, unmatched, failed, total: albums.length }), jobId);
  } catch (error) {
    database.prepare("UPDATE jobs SET status='failed',detail=?,error_detail=?,finished_at=CURRENT_TIMESTAMP WHERE id=?").run(String(error), String(error), jobId);
    throw error;
  } finally {
    database.close();
  }
  console.log(JSON.stringify({ event: "identity_backfill_complete", resolved, unmatched, failed, total: albums.length }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
