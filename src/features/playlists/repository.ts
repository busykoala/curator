import { db } from "@/features/db/client";
import {
  definitionInputSchema,
  playlistConfigSchema,
  type PlaylistDefinition,
} from "./types";
import { nextZurichRunSql } from "./schedule-time";
import {playlistRevisionHash} from './refresh-policy';
import {playlistRefreshView} from './refresh-status';
import {songExplanation} from './song-explanation';
import {discoveryRecommendations} from './discovery-repository';

type Row = {
  id: number;
  revision: number;
  name: string;
  category: string;
  enabled: number;
  intent: string;
  config_json: string;
  owner_user_id: number;
  owner_display_name: string;
  owner_token_status: string;
  navidrome_playlist_id: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
};
const select = `SELECT p.*,coalesce(u.display_name,'Unknown user') owner_display_name,coalesce(u.token_status,'missing') owner_token_status FROM smart_playlists p LEFT JOIN curator_users u ON u.id=p.owner_user_id`;
function definition(row: Row): PlaylistDefinition {
  const result:PlaylistDefinition = {
    id: row.id,
    revision: row.revision,
    name: row.name,
    category: row.category as PlaylistDefinition["category"],
    enabled: Boolean(row.enabled),
    intent: row.intent,
    config: playlistConfigSchema.parse(JSON.parse(row.config_json)),
    ownerUserId: row.owner_user_id,
    ownerDisplayName: row.owner_display_name,
    ownerTokenStatus: row.owner_token_status,
    navidromePlaylistId: row.navidrome_playlist_id,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return{...result,...playlistRefreshView(result)};
}
function ownerExists(id: number) {
  return Boolean(
    db().prepare("SELECT 1 FROM curator_users WHERE id=?").get(id),
  );
}
export function listPlaylists(ownerUserId?: number) {
  const where = ownerUserId ? " WHERE p.owner_user_id=?" : "";
  return (
    db()
      .prepare(`${select}${where} ORDER BY p.category,p.name`)
      .all(...(ownerUserId ? [ownerUserId] : [])) as Row[]
  ).map(definition);
}
export function getPlaylist(id: number) {
  const row = db().prepare(`${select} WHERE p.id=?`).get(id) as Row | undefined;
  return row ? definition(row) : undefined;
}
export function createPlaylist(input: unknown) {
  const value = definitionInputSchema.parse(input);
  if (!ownerExists(value.ownerUserId))
    throw new Error("Playlist owner has not signed into Curator");
  const row = db()
    .prepare(
      "INSERT INTO smart_playlists(name,category,enabled,intent,config_json,owner_user_id) VALUES (?,?,?,?,?,?) RETURNING *",
    )
    .get(
      value.name,
      value.category,
      value.enabled ? 1 : 0,
      value.intent,
      JSON.stringify(value.config),
      value.ownerUserId,
    ) as Omit<Row, "owner_display_name" | "owner_token_status">;
  return getPlaylist(row.id)!;
}
export function updatePlaylist(id: number, input: unknown) {
  const current = getPlaylist(id);
  if (!current) throw new Error("Playlist not found");
  const patch =
    typeof input === "object" && input
      ? (input as Record<string, unknown>)
      : {};
  const value = definitionInputSchema.parse({
    ...current,
    ...patch,
    config: {
      ...current.config,
      ...((patch.config as object | undefined) ?? {}),
    },
  });
  if (!ownerExists(value.ownerUserId))
    throw new Error("Playlist owner has not signed into Curator");
  const ownerChanged = value.ownerUserId !== current.ownerUserId;
  db()
    .prepare(
      "UPDATE smart_playlists SET name=?,category=?,enabled=?,intent=?,config_json=?,owner_user_id=?,automatic=0,navidrome_playlist_id=?,revision=revision+1,next_run_at=CASE WHEN ?=0 THEN NULL ELSE next_run_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .run(
      value.name,
      value.category,
      value.enabled ? 1 : 0,
      value.intent,
      JSON.stringify(value.config),
      value.ownerUserId,
      ownerChanged ? null : current.navidromePlaylistId,
      value.enabled ? 1 : 0,
      id,
    );
  return getPlaylist(id)!;
}
export function removePlaylist(id: number) {
  db().prepare("DELETE FROM smart_playlists WHERE id=?").run(id);
}
export function setNavidromeId(id: number, value: string) {
  db()
    .prepare(
      "UPDATE smart_playlists SET navidrome_playlist_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .run(value, id);
}
export function markRun(id: number) {
  db()
    .prepare(
      "UPDATE smart_playlists SET last_run_at=CURRENT_TIMESTAMP,next_run_at=CASE WHEN enabled=1 THEN ? ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .run(nextZurichRunSql(), id);
}
export function refreshNextRunTimes() {
  const next = nextZurichRunSql();
  db()
    .prepare(
      "UPDATE smart_playlists SET next_run_at=? WHERE enabled=1 AND next_run_at IS NOT ?",
    )
    .run(next, next);
  db().prepare('UPDATE smart_playlists SET next_run_at=NULL WHERE enabled=0 AND next_run_at IS NOT NULL').run();
}
export function playlistRuns(id: number) {
  return db()
    .prepare(
      "SELECT id,status,preview,detail_json,error,started_at,finished_at FROM playlist_runs WHERE playlist_id=? ORDER BY id DESC LIMIT 12",
    )
    .all(id);
}
export function feedback(
  id: number,
  fileId: number,
  artist: string,
  action: string,
) {
  const owner = getPlaylist(id)?.ownerUserId;
  if (!owner) throw new Error("Playlist not found");
  const scope = action === "snooze" ? null : id;
  db()
    .prepare(
      "DELETE FROM playlist_feedback WHERE owner_user_id=? AND playlist_id IS ? AND file_id=? AND action IN ('pin','exclude','snooze','artist_exclude')",
    )
    .run(owner, scope, fileId);
  db()
    .prepare(
      `INSERT INTO playlist_feedback(owner_user_id,playlist_id,file_id,artist,action,expires_at) VALUES (?,?,?,?,?,${action === "snooze" ? "datetime('now','+30 days')" : "NULL"})`,
    )
    .run(owner, scope, fileId, artist, action);
  db().prepare('UPDATE smart_playlists SET revision=revision+1 WHERE owner_user_id=? AND (id=? OR ? IS NULL)').run(owner,id,scope);
}
export function removeFeedback(id: number, fileId: number, action: string) {
  const owner = getPlaylist(id)?.ownerUserId,
    scope = action === "snooze" ? null : id;
  db()
    .prepare(
      "DELETE FROM playlist_feedback WHERE owner_user_id=? AND playlist_id IS ? AND file_id=? AND action=?",
    )
    .run(owner, scope, fileId, action);
  db().prepare('UPDATE smart_playlists SET revision=revision+1 WHERE owner_user_id=? AND (id=? OR ? IS NULL)').run(owner,id,scope);
}

export function dashboardData(ownerUserId: number) {
  const definitions = listPlaylists(ownerUserId);
  return {
    definitions: definitions.map((item) => ({
      ...item,
      runs: playlistRuns(item.id),
      unreadReply:
        item.category === "chat"
          ? Boolean(
              db()
                .prepare(
                  "SELECT 1 FROM playlist_chat_state WHERE playlist_id=? AND revision>read_revision",
                )
                .get(item.id),
            )
          : false,
      chatJob:
        item.category === "chat"
          ? (db()
              .prepare(
                "SELECT status,sync_error syncError,updated_at updatedAt FROM playlist_chat_jobs WHERE playlist_id=? ORDER BY rowid DESC LIMIT 1",
              )
              .get(item.id) ?? null)
          : null,
    })),
    clusters: db()
      .prepare(
        "SELECT id,user_id,label,terms_json,evidence_json,weight,updated_at FROM listening_clusters WHERE user_id=? ORDER BY weight DESC,label",
      )
      .all(ownerUserId),
    acquisitions: db()
      .prepare(
        "SELECT d.*,r.artist,r.album,r.release_date,r.genres_json,r.evidence_json sources_json,p.name lane FROM playlist_discovery_recommendations d JOIN playlist_discovery_releases r ON r.id=d.release_id JOIN smart_playlists p ON p.id=d.playlist_id AND p.owner_user_id=d.owner_user_id WHERE d.owner_user_id=? ORDER BY d.updated_at DESC LIMIT 80",
      )
      .all(ownerUserId),
  };
}

export function playlistSnapshot(id: number) {
  const definition = getPlaylist(id);
  const run = db()
    .prepare(
      "SELECT id,preview,started_at,config_hash FROM playlist_runs WHERE playlist_id=? AND status='complete' ORDER BY id DESC LIMIT 1",
    )
    .get(id) as
    | { id: number; preview: number; started_at: string; config_hash: string }
    | undefined;
  const items = run
    ? db()
        .prepare(
          `SELECT i.file_id fileId,f.artist_name artist,f.album_name album,f.album_key albumKey,coalesce(json_extract(f.tags_json,'$.title[0]'),json_extract(f.tags_json,'$.title'),'Untitled') title,i.reason,i.retained FROM playlist_items i JOIN files f ON f.id=i.file_id WHERE i.run_id=? ORDER BY i.position`,
        )
        .all(run.id).map(row=>({...row as Record<string,unknown>,explanation:definition?songExplanation((row as {fileId:number}).fileId,id,definition.ownerUserId):null}))
    : [];
  const latestRun = db()
    .prepare(
      "SELECT status FROM playlist_runs WHERE playlist_id=? ORDER BY id DESC LIMIT 1",
    )
    .get(id);
  return {
    definition,
    items,
    discoveries:definition?discoveryRecommendations(id,definition.ownerUserId).filter(row=>!['dismissed','presented'].includes(row.status)).map(row=>({id:row.id,artist:row.artist,album:row.album,status:row.status,releaseId:row.release_id})):[],
    latestRun,
    preview: Boolean(run?.preview),
    runId: run?.id ?? null,
    stale: Boolean(
      run?.preview &&
        definition &&
        run.config_hash !==
          playlistRevisionHash(definition),
    ),
  };
}
