import { createHash } from "node:crypto";
import { db } from "@/features/db/client";
import {
  navidromeListeningProfile,
  replaceManagedPlaylist,
  unresolvedNavidromeCandidates,
} from "@/features/integrations/navidrome";
import {
  type ListeningProfile,
  norm,
  scoreCandidate,
} from "./candidate-score";
import { getPlaylist, markRun, setNavidromeId } from "./repository";
import { sequenceJourney } from "./sequence";
import { playlistAwaitingAcquisition } from "./discovery";
import type {
  PlaylistCandidate,
  PlaylistDefinition,
} from "./types";

type Row = {
  id: number;
  artist_name: string;
  album_name: string;
  tags_json: string;
  profile_json: string;
};

function values(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
}

function trackTitle(tags: Record<string, unknown>) {
  return values(tags.title)[0] ?? "Untitled";
}

function candidates(
  definition: PlaylistDefinition,
  listening?: ListeningProfile,
) {
  const rows = db()
    .prepare(
      "SELECT f.id,f.artist_name,f.album_name,f.tags_json,p.profile_json FROM files f JOIN track_profiles p ON p.file_id=f.id WHERE f.status='written' AND p.status='complete'",
    )
    .all() as Row[];

  return rows.flatMap((row) => {
    const tags = JSON.parse(row.tags_json) as Record<string, unknown>;
    const profile = JSON.parse(row.profile_json) as Record<string, unknown>;
    const title = trackTitle(tags);
    const year =
      Number(String(values(tags.date)[0] ?? tags.year ?? 0).slice(0, 4)) || 0;
    const scored = scoreCandidate({
      definition,
      artist: row.artist_name,
      album: row.album_name,
      title,
      year,
      tags,
      profile,
      listening,
    });
    return scored.eligible
      ? [
          {
            fileId: row.id,
            title,
            artist: row.artist_name,
            album: row.album_name,
            year,
            profile,
            score: scored.score,
            reason: scored.reason,
            origin: "catalog" as const,
          },
        ]
      : [];
  });
}

function activeFeedback(id: number) {
  const rows = db()
    .prepare(
      "SELECT playlist_id,file_id,artist,action FROM playlist_feedback WHERE (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP) AND (playlist_id=? OR playlist_id IS NULL)",
    )
    .all(id) as Array<{
    file_id: number;
    artist: string;
    action: string;
  }>;
  return {
    pins: new Set(
      rows.filter((row) => row.action === "pin").map((row) => row.file_id),
    ),
    excluded: new Set(
      rows
        .filter((row) => row.action === "exclude" || row.action === "snooze")
        .map((row) => row.file_id),
    ),
    artists: new Set(
      rows
        .filter((row) => row.action === "artist_exclude")
        .map((row) => norm(row.artist)),
    ),
  };
}

function previous(id: number) {
  const rows = db()
    .prepare(
      "SELECT file_id FROM playlist_items WHERE run_id=(SELECT id FROM playlist_runs WHERE playlist_id=? AND preview=0 AND status='complete' ORDER BY id DESC LIMIT 1)",
    )
    .all(id) as Array<{ file_id: number }>;
  return new Set(rows.map((row) => row.file_id));
}

function select(
  definition: PlaylistDefinition,
  listening?: ListeningProfile,
  ignored = new Set<number>(),
) {
  const feedback = activeFeedback(definition.id);
  const prior = previous(definition.id);
  const pool = candidates(definition, listening).filter(
    (item) =>
      !feedback.excluded.has(item.fileId) &&
      !feedback.artists.has(norm(item.artist)) &&
      !ignored.has(item.fileId),
  );
  const seed = new Date().toISOString().slice(0, 10);
  pool.sort(
    (left, right) =>
      Number(feedback.pins.has(right.fileId)) -
        Number(feedback.pins.has(left.fileId)) ||
      Number(prior.has(right.fileId)) - Number(prior.has(left.fileId)) ||
      right.score - left.score ||
      hash(seed + ":" + definition.id + ":" + left.fileId) -
        hash(seed + ":" + definition.id + ":" + right.fileId),
  );

  const target = definition.config.targetTracks;
  const candidateTarget =
    definition.category === "journey"
      ? Math.min(pool.length, target * 4)
      : target;
  const retain = Math.round(
    target * (1 - definition.config.rotationPercent / 100),
  );
  const chosen: PlaylistCandidate[] = [];
  const artists = new Map<string, number>();
  const albums = new Map<string, number>();
  const recordings = new Set<string>();

  for (const item of pool) {
    const retained = prior.has(item.fileId);
    const pinned = feedback.pins.has(item.fileId);
    const retainedCount = chosen.filter((value) => value.retained).length;
    if (retained && !pinned && retainedCount >= retain) continue;
    if (!addable(item, pinned, definition, artists, albums, recordings)) continue;
    chosen.push({ ...item, retained });
    if (chosen.length >= candidateTarget) break;
  }

  if (chosen.length < candidateTarget) {
    for (const item of pool) {
      if (
        chosen.some((value) => value.fileId === item.fileId) ||
        !addable(item, false, definition, artists, albums, recordings)
      ) {
        continue;
      }
      chosen.push(item);
      if (chosen.length >= candidateTarget) break;
    }
  }

  return definition.category === "journey"
    ? sequenceJourney(chosen, definition.config)
    : chosen;
}

function addable(
  item: PlaylistCandidate,
  pinned: boolean,
  definition: PlaylistDefinition,
  artists: Map<string, number>,
  albums: Map<string, number>,
  recordings: Set<string>,
) {
  const artist = norm(item.artist);
  const album = artist + "|" + norm(item.album);
  const recording = artist + "|" + norm(item.title);
  if (recordings.has(recording)) return false;
  if (
    !pinned &&
    ((artists.get(artist) ?? 0) >= definition.config.maxTracksPerArtist ||
      (albums.get(album) ?? 0) >= definition.config.maxTracksPerAlbum)
  ) {
    return false;
  }
  artists.set(artist, (artists.get(artist) ?? 0) + 1);
  albums.set(album, (albums.get(album) ?? 0) + 1);
  recordings.add(recording);
  return true;
}

const hash = (value: string) =>
  parseInt(createHash("sha1").update(value).digest("hex").slice(0, 8), 16);

export async function generatePlaylist(id: number, preview = false) {
  const definition = getPlaylist(id);
  if (!definition) throw new Error("Playlist not found");
  const configHash = createHash("sha256")
    .update(JSON.stringify(definition))
    .digest("hex");
  const run = db()
    .prepare(
      "INSERT INTO playlist_runs(playlist_id,status,preview,config_hash) VALUES (?,'running',?,?) RETURNING id",
    )
    .get(id, preview ? 1 : 0, configHash) as { id: number };

  try {
    const listening =
      definition.category === "rediscovery"
        ? ((await navidromeListeningProfile().catch(() => ({
            frequent: [],
            starred: {},
          }))) as ListeningProfile)
        : undefined;
    let items = select(definition, listening);
    let navidromeId = definition.navidromePlaylistId;
    let songIds = new Map<number, string>();
    if (!preview) {
      const ignored = new Set<number>();
      for (
        let attempt = 0;
        attempt < Math.max(12, definition.config.targetTracks);
        attempt += 1
      ) {
        const unresolved = await unresolvedNavidromeCandidates(items);
        if (!unresolved.length) break;
        const ignoredBefore = ignored.size;
        unresolved.forEach((item) => ignored.add(item.fileId));
        items = select(definition, listening, ignored);
        if (
          ignored.size === ignoredBefore ||
          items.length < definition.config.targetTracks
        ) break;
      }
      const unresolved = await unresolvedNavidromeCandidates(items);
      if (unresolved.length || items.length < definition.config.targetTracks) {
        throw new Error(`Only ${items.length - unresolved.length} of ${definition.config.targetTracks} tracks have unambiguous Navidrome identity`);
      }
      const synced = await replaceManagedPlaylist(definition, items);
      navidromeId = synced.playlistId;
      songIds = synced.songIds;
      setNavidromeId(id, synced.playlistId);
      markRun(id);
    }
    const insert = db().prepare(
      "INSERT INTO playlist_items(run_id,playlist_id,file_id,navidrome_song_id,position,score,origin,reason,retained) VALUES (?,?,?,?,?,?,?,?,?)",
    );
    db().transaction(() =>
      items.forEach((item, index) =>
        insert.run(
          run.id,
          id,
          item.fileId,
          songIds.get(item.fileId) ?? null,
          index,
          item.score,
          item.origin,
          item.reason,
          item.retained ? 1 : 0,
        ),
      ),
    )();
    const detail = {
      tracks: items.length,
      retained: items.filter((item) => item.retained).length,
      pending: Math.max(0, definition.config.targetTracks - items.length),
      navidromeId,
    };
    db()
      .prepare(
        "UPDATE playlist_runs SET status='complete',detail_json=?,finished_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .run(JSON.stringify(detail), run.id);
    return { runId: run.id, definition, items, detail };
  } catch (error) {
    db()
      .prepare(
        "UPDATE playlist_runs SET status='failed',error=?,finished_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .run(String(error), run.id);
    throw error;
  }
}

export async function generateEnabledPlaylists() {
  const rows = db()
    .prepare("SELECT id,name FROM smart_playlists WHERE enabled=1 ORDER BY id")
    .all() as Array<{ id: number; name: string }>;
  const results = [];
  for (const row of rows) {
    const acquisition = playlistAwaitingAcquisition(row.name);
    if (acquisition) {
      results.push({ playlistId: row.id, waitingForAcquisition: true, acquisition });
      continue;
    }
    try {
      results.push(await generatePlaylist(row.id, false));
    } catch (error) {
      results.push({ playlistId: row.id, error: String(error) });
    }
  }
  return results;
}
