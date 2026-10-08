import { randomUUID } from "node:crypto";
import { db } from "@/features/db/client";
import { aiConfigured } from "@/features/ai/client";
import { chatState, releaseChatLease } from "./chat-state";
import { chatSubmissionSchema } from "./chat-request";
import { createPlaylist, getPlaylist } from "./repository";

export type ChatJob = {
  id: string; playlistId: number; message: string; targetTracks: number; revision: number;
  status: "queued" | "running" | "completed" | "failed"; phase: string;
  resultRevision: number | null; syncRequired: boolean; synced: boolean; syncError: string;
  error: string; attempts: number; createdAt: number; updatedAt: number;
};
type Row = {
  id: string; playlist_id: number; message: string; target_tracks: number; base_revision: number;
  status: ChatJob["status"]; phase: string; result_revision: number | null; sync_required: number;
  synced: number; sync_error: string; error: string; attempts: number; created_at: number;
  updated_at: number; lease_token: string | null; lease_until: number;
};
function map(row: Row): ChatJob {
  return { id: row.id, playlistId: row.playlist_id, message: row.message, targetTracks: row.target_tracks,
    revision: row.base_revision, status: row.status, phase: row.phase, resultRevision: row.result_revision,
    syncRequired: Boolean(row.sync_required), synced: Boolean(row.synced), syncError: row.sync_error,
    error: row.error, attempts: row.attempts, createdAt: row.created_at, updatedAt: row.updated_at };
}
export function latestChatJob(id: number) {
  const row = db().prepare("SELECT * FROM playlist_chat_jobs WHERE playlist_id=? ORDER BY rowid DESC LIMIT 1").get(id) as Row | undefined;
  return row ? map(row) : null;
}
export function playlistChatView(id: number) {
  const job = latestChatJob(id);
  return { definition: getPlaylist(id)!, ...chatState(id), job,
    synced: job?.status === "completed" && job.synced,
    syncError: job?.status === "completed" ? job.syncError : "" };
}
export function assertChatIdle(id: number) {
  if (db().prepare("SELECT 1 FROM playlist_chat_jobs WHERE playlist_id=? AND status IN ('queued','running')").get(id))
    throw new Error("This playlist is already being updated. Please wait for that update to finish.");
}
export function enqueuePlaylistMessage(id: number, raw: unknown) {
  const request = chatSubmissionSchema.parse(raw), requestId = request.requestId ?? randomUUID();
  return db().transaction(() => {
    const definition = getPlaylist(id);
    if (!definition || definition.category !== "chat") throw new Error("Chat playlist not found");
    const existing = db().prepare("SELECT * FROM playlist_chat_jobs WHERE id=?").get(requestId) as Row | undefined;
    if (existing) {
      if (existing.playlist_id !== id || existing.message !== request.message || existing.target_tracks !== request.targetTracks || existing.base_revision !== request.revision)
        throw new Error("This request ID has already been used for a different message.");
      return playlistChatView(id);
    }
    if (!aiConfigured) throw new Error("The AI service is not configured.");
    if (request.revision !== chatState(id).revision) throw new Error("This conversation has changed. Reopen the playlist and retry.");
    assertChatIdle(id);
    const lease = db().prepare("SELECT lease_until FROM playlist_chat_state WHERE playlist_id=?").get(id) as { lease_until: number } | undefined;
    if (lease && lease.lease_until > Date.now()) throw new Error("This playlist is already being updated. Please wait for that update to finish.");
    const now = Date.now();
    db().prepare("INSERT INTO playlist_chat_jobs(id,playlist_id,message,target_tracks,base_revision,sync_required,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(requestId, id, request.message, request.targetTracks, request.revision, definition.navidromePlaylistId ? 1 : 0, now, now);
    return playlistChatView(id);
  })();
}
export function createPlaylistChat(ownerUserId: number, raw: unknown) {
  const request = chatSubmissionSchema.parse(raw), requestId = request.requestId ?? randomUUID();
  if (request.revision !== 0) throw new Error("A new conversation must start at revision zero.");
  return db().transaction(() => {
    const existing = db().prepare("SELECT playlist_id FROM playlist_chat_jobs WHERE id=?").get(requestId) as {playlist_id:number}|undefined;
    if (existing) {
      if (getPlaylist(existing.playlist_id)?.ownerUserId !== ownerUserId) throw new Error("This request ID has already been used for a different message.");
      return enqueuePlaylistMessage(existing.playlist_id, {...request,requestId});
    }
    const playlist = createPlaylist({name:`Chat playlist ${requestId}`,category:"chat",enabled:false,ownerUserId,config:{targetTracks:request.targetTracks}});
    return enqueuePlaylistMessage(playlist.id,{...request,requestId});
  })();
}
const LEASE_MS = 90_000;
export function claimChatJob(now = Date.now()) {
  return db().transaction(() => {
    const interrupted = db().prepare("SELECT * FROM playlist_chat_jobs WHERE status='running' AND lease_until<?").all(now) as Row[];
    for (const row of interrupted) {
      if (row.lease_token) releaseChatLease(row.playlist_id, row.lease_token);
      db().prepare("UPDATE playlist_chat_jobs SET status=?,lease_token=NULL,lease_until=0,error=?,updated_at=? WHERE id=?")
        .run(row.attempts < 3 ? "queued" : "failed", row.attempts < 3 ? "" : "The background worker was interrupted repeatedly. Please retry your message.", now, row.id);
    }
    const token = randomUUID();
    const row = db().prepare(`UPDATE playlist_chat_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=?
      WHERE id=(SELECT id FROM playlist_chat_jobs WHERE status='queued' ORDER BY created_at,rowid LIMIT 1) RETURNING *`).get(token, now + LEASE_MS, now) as Row | undefined;
    return row ? { ...map(row), lease: token } : null;
  })();
}
export function heartbeatChatJob(id: string, lease: string) {
  return db().transaction(() => {
    const now = Date.now();
    const result = db().prepare("UPDATE playlist_chat_jobs SET lease_until=? WHERE id=? AND lease_token=? AND status='running' AND lease_until>?").run(now + LEASE_MS, id, lease, now);
    if (result.changes) db().prepare("UPDATE playlist_chat_state SET lease_until=? WHERE lease=?").run(now + 600_000, lease);
    return Boolean(result.changes);
  })();
}
export function checkpointChatJob(id: string, lease: string, revision: number) {
  const result = db().prepare("UPDATE playlist_chat_jobs SET phase='sync',result_revision=?,updated_at=? WHERE id=? AND lease_token=? AND status='running' AND lease_until>?")
    .run(revision, Date.now(), id, lease, Date.now());
  if (!result.changes) throw new Error("Background job lease expired before saving the reply.");
}
export function finishChatJob(id: string, lease: string, result: { synced?: boolean; syncError?: string; error?: string }) {
  const now = Date.now();
  return db().prepare("UPDATE playlist_chat_jobs SET status=?,synced=?,sync_error=?,error=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND lease_token=? AND status='running' AND lease_until>?")
    .run(result.error ? "failed" : "completed", result.synced ? 1 : 0, result.syncError ?? "", result.error ?? "", now, id, lease, now).changes > 0;
}
export function markChatSynced(id: number) {
  db().prepare("UPDATE playlist_chat_jobs SET synced=1,sync_error='',updated_at=? WHERE playlist_id=? AND status='completed' AND result_revision=?")
    .run(Date.now(), id, chatState(id).revision);
}
