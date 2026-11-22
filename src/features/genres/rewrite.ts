import { dirname } from "node:path";
import { db, stateGet, stateSet } from "@/features/db/client";
import { analyzerConfigured, AUDIO_MODEL_VERSION } from "@/features/audio-model/client";
import { acquireAlbumLease, releaseAlbumLease } from "@/features/scheduler/album-lease";
import { writeMetadata } from "@/features/writer/write";
import { rescanFolders } from "@/features/sources/lidarr";
import { deriveAndStoreAlbum, derivedTagProperties, GENRE_DERIVATION_VERSION } from "./derive";

const list = (value: unknown): string[] => (Array.isArray(value) ? value : value == null ? [] : [value]).map(String).filter(Boolean);
const same = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

/** Albums whose derivation is missing, outdated, or older than its evidence. */
function staleAlbums(limit: number): string[] {
  return (db().prepare(`SELECT f.album_key FROM files f
    LEFT JOIN genre_derivations g ON g.file_id=f.id
    LEFT JOIN track_profiles p ON p.file_id=f.id
    LEFT JOIN audio_model_results a ON a.file_id=f.id AND a.error IS NULL
    WHERE f.status IN ('analyzed','written') AND (g.file_id IS NULL OR g.derivation_version<>? OR p.updated_at>g.updated_at OR a.updated_at>g.updated_at)
    GROUP BY f.album_key LIMIT ?`).all(GENRE_DERIVATION_VERSION, limit) as Array<{ album_key: string }>).map(row => row.album_key);
}

/** Audio analysis is finished for the album (analysed, or permanently unreadable). */
function audioSettled(albumKey: string) {
  if (!analyzerConfigured()) return true;
  const row = db().prepare(`SELECT count(*) n FROM files f LEFT JOIN audio_model_results a ON a.file_id=f.id AND a.model_version=?
    WHERE f.album_key=? AND f.status IN ('analyzed','written') AND (a.file_id IS NULL OR (a.error IS NOT NULL AND a.attempts<5))`).get(AUDIO_MODEL_VERSION, albumKey) as { n: number };
  return row.n === 0;
}

type FileRow = { id: number; path: string; inode: number; size: number; mtime_ms: number; applied_hash: string | null; tags_json: string; status: string };
function pendingWrites(albumKey: string) {
  const files = db().prepare("SELECT id,path,inode,size,mtime_ms,applied_hash,tags_json,status FROM files WHERE album_key=? AND status='written'").all(albumKey) as FileRow[];
  return files.flatMap(file => {
    const desired = derivedTagProperties(file.id);
    if (!desired) return [];
    const tags = JSON.parse(file.tags_json || "{}") as Record<string, unknown>, extra = (tags.extraProperties ?? {}) as Record<string, unknown>;
    const genre = list(tags.genre ?? extra.GENRE), style = list(extra.STYLE ?? tags.style);
    return same(genre, desired.GENRE) && same(style, desired.STYLE) ? [] : [{ file, desired }];
  });
}

/**
 * Keep GENRE/STYLE tags in line with the derivation: derive up to `deriveLimit`
 * stale albums, then rewrite at most `writeLimit` albums whose tags differ. Only
 * the two tags are written, through the copy-on-write writer under the album
 * lease. Waits for the source-fingerprint migration so rewrites never look like
 * changed sources to the classifier.
 */
export async function maintainGenreTags(deriveLimit = 150, writeLimit = 25) {
  let derived = 0, albums = 0, written = 0;
  for (const albumKey of staleAlbums(deriveLimit)) { deriveAndStoreAlbum(albumKey); derived++; }
  if (stateGet("source_fingerprint_v2") !== "done" || stateGet("genre_rewrite_paused") === "true") return { derived, albums, written };
  const candidates = db().prepare("SELECT DISTINCT g.album_key FROM genre_derivations g JOIN files f ON f.id=g.file_id WHERE g.derivation_version=? AND f.status='written' ORDER BY g.updated_at DESC LIMIT 2000").all(GENRE_DERIVATION_VERSION) as Array<{ album_key: string }>;
  const folders = new Set<string>();
  for (const { album_key: albumKey } of candidates) {
    if (albums >= writeLimit || stateGet("paused") === "true") break;
    if (!audioSettled(albumKey)) continue;
    const writes = pendingWrites(albumKey);
    if (!writes.length || !acquireAlbumLease(albumKey, "write")) continue;
    try {
      for (const { file, desired } of writes) {
        try { if ((await writeMetadata(file, { properties: desired })) === "written") { written++; folders.add(dirname(file.path)); } }
        catch (error) { console.warn(JSON.stringify({ event: "genre_rewrite_deferred", fileId: file.id, error: String(error) })); }
      }
      albums++;
    } finally { releaseAlbumLease(albumKey, "write"); }
  }
  if (folders.size) await rescanFolders([...folders]).catch(() => undefined);
  const remaining = (db().prepare("SELECT count(DISTINCT album_key) n FROM files WHERE status IN ('analyzed','written')").get() as { n: number }).n;
  stateSet("genre_rewrite_progress", JSON.stringify({ derived, albums, written, libraryAlbums: remaining, at: new Date().toISOString() }));
  return { derived, albums, written };
}
