import { db } from "@/features/db/client";
import { definitionInputSchema, playlistConfigSchema, type PlaylistDefinition } from "./types";
import { nextZurichRunSql } from "./schedule-time";

type Row = { id:number; name:string; category:string; automatic:number; enabled:number; intent:string; config_json:string; owner_user_id:number; owner_display_name:string; owner_token_status:string; navidrome_playlist_id:string|null; last_run_at:string|null; next_run_at:string|null; created_at:string; updated_at:string };
const select = `SELECT p.*,coalesce(u.display_name,'Unknown user') owner_display_name,coalesce(u.token_status,'missing') owner_token_status FROM smart_playlists p LEFT JOIN curator_users u ON u.id=p.owner_user_id`;
function definition(row: Row): PlaylistDefinition { return { id:row.id, name:row.name, category:row.category as PlaylistDefinition["category"], enabled:Boolean(row.enabled), automatic:Boolean(row.automatic), intent:row.intent, config:playlistConfigSchema.parse(JSON.parse(row.config_json)), ownerUserId:row.owner_user_id, ownerDisplayName:row.owner_display_name, ownerTokenStatus:row.owner_token_status, navidromePlaylistId:row.navidrome_playlist_id, lastRunAt:row.last_run_at, nextRunAt:row.next_run_at, createdAt:row.created_at, updatedAt:row.updated_at }; }
function ownerExists(id: number) { return Boolean(db().prepare("SELECT 1 FROM curator_users WHERE id=?").get(id)); }
export function listPlaylists(ownerUserId?: number) { const where = ownerUserId ? " WHERE p.owner_user_id=?" : ""; return (db().prepare(`${select}${where} ORDER BY p.category,p.name`).all(...(ownerUserId ? [ownerUserId] : [])) as Row[]).map(definition); }
export function getPlaylist(id:number) { const row=db().prepare(`${select} WHERE p.id=?`).get(id) as Row|undefined; return row?definition(row):undefined; }
export function createPlaylist(input:unknown) { const value=definitionInputSchema.parse(input); if(!ownerExists(value.ownerUserId))throw new Error("Playlist owner has not signed into Curator"); const row=db().prepare("INSERT INTO smart_playlists(name,category,enabled,intent,config_json,owner_user_id) VALUES (?,?,?,?,?,?) RETURNING *").get(value.name,value.category,value.enabled?1:0,value.intent,JSON.stringify(value.config),value.ownerUserId) as Omit<Row,"owner_display_name"|"owner_token_status">; return getPlaylist(row.id)!; }
export function updatePlaylist(id: number, input: unknown) {
  const current = getPlaylist(id);
  if (!current) throw new Error("Playlist not found");
  const patch = typeof input === "object" && input ? input as Record<string, unknown> : {};
  const value = definitionInputSchema.parse({ ...current, ...patch, config: { ...current.config, ...((patch.config as object | undefined) ?? {}) } });
  if (!ownerExists(value.ownerUserId)) throw new Error("Playlist owner has not signed into Curator");
  const ownerChanged = value.ownerUserId !== current.ownerUserId;
  // Refresh controls do not change ownership. Saving the direction does, while
  // the default registry keeps the original pick from being created again.
  const customized = ["name", "category", "intent", "config", "ownerUserId"].some(key => Object.hasOwn(patch, key));
  db().prepare("UPDATE smart_playlists SET name=?,category=?,enabled=?,intent=?,config_json=?,owner_user_id=?,automatic=?,navidrome_playlist_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(value.name, value.category, value.enabled ? 1 : 0, value.intent, JSON.stringify(value.config), value.ownerUserId, current.automatic && !customized ? 1 : 0, ownerChanged ? null : current.navidromePlaylistId, id);
  return getPlaylist(id)!;
}
export function removePlaylist(id:number){db().prepare("DELETE FROM smart_playlists WHERE id=?").run(id)}
export function setNavidromeId(id:number,value:string){db().prepare("UPDATE smart_playlists SET navidrome_playlist_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(value,id)}
export function markRun(id:number){db().prepare("UPDATE smart_playlists SET last_run_at=CURRENT_TIMESTAMP,next_run_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(nextZurichRunSql(),id)}
export function refreshNextRunTimes(){const next=nextZurichRunSql();db().prepare("UPDATE smart_playlists SET next_run_at=? WHERE enabled=1 AND next_run_at IS NOT ?").run(next,next)}
export function playlistRuns(id:number){return db().prepare("SELECT id,status,preview,detail_json,error,started_at,finished_at FROM playlist_runs WHERE playlist_id=? ORDER BY id DESC LIMIT 12").all(id)}
export function feedback(id:number,fileId:number,artist:string,action:string){
  const owner=getPlaylist(id)?.ownerUserId;if(!owner)throw new Error("Playlist not found");
  const scope=action==="snooze"?null:id;
  db().prepare("DELETE FROM playlist_feedback WHERE owner_user_id=? AND playlist_id IS ? AND file_id=? AND action IN ('pin','exclude','snooze','artist_exclude')").run(owner,scope,fileId);
  db().prepare(`INSERT INTO playlist_feedback(owner_user_id,playlist_id,file_id,artist,action,expires_at) VALUES (?,?,?,?,?,${action==="snooze"?"datetime('now','+30 days')":"NULL"})`).run(owner,scope,fileId,artist,action);
}
export function removeFeedback(id:number,fileId:number,action:string){const owner=getPlaylist(id)?.ownerUserId,scope=action==="snooze"?null:id;db().prepare("DELETE FROM playlist_feedback WHERE owner_user_id=? AND playlist_id IS ? AND file_id=? AND action=?").run(owner,scope,fileId,action)}

export function dashboardData(ownerUserId:number){const definitions=listPlaylists(ownerUserId);return{definitions:definitions.map(item=>({...item,runs:playlistRuns(item.id),chatJob:item.category==="chat"?db().prepare("SELECT status,updated_at updatedAt FROM playlist_chat_jobs WHERE playlist_id=? ORDER BY rowid DESC LIMIT 1").get(item.id)??null:null})),clusters:db().prepare("SELECT id,user_id,label,terms_json,evidence_json,weight,updated_at FROM listening_clusters WHERE user_id=? ORDER BY weight DESC,label").all(ownerUserId),acquisitions:db().prepare("SELECT d.* FROM discovery_candidates d WHERE EXISTS (SELECT 1 FROM smart_playlists p WHERE p.owner_user_id=? AND lower(p.name)=lower(d.lane)) ORDER BY d.updated_at DESC LIMIT 80").all(ownerUserId)}}
// A choice remains registered after customization, transfer, or deletion. The
// playlist name is editable and must never be used as a default's identity.
export function ensurePlaylist(input: unknown, defaultKey?: string) {
  const value = definitionInputSchema.parse(input);
  const key = defaultKey ?? `${value.category}:${value.name.toLowerCase()}`;
  return db().transaction(() => {
    if (db().prepare("SELECT 1 FROM automatic_playlist_choices WHERE owner_user_id=? AND default_key=?").get(value.ownerUserId, key)) return false;
    const existing = db().prepare("SELECT id FROM smart_playlists WHERE owner_user_id=? AND category=? AND lower(name)=lower(?)").get(value.ownerUserId, value.category, value.name) as { id: number } | undefined;
    let id = existing?.id;
    if (!id) {
      let name = value.name;
      for (let suffix = 1; db().prepare("SELECT 1 FROM smart_playlists WHERE owner_user_id=? AND lower(name)=lower(?)").get(value.ownerUserId, name); suffix++) {
        const ending = suffix === 1 ? " · Curator" : ` · Curator ${suffix}`;
        name = value.name.slice(0, 100 - ending.length) + ending;
      }
      const result = db().prepare("INSERT INTO smart_playlists(name,category,enabled,intent,config_json,owner_user_id,automatic) VALUES (?,?,?,?,?,?,1)")
        .run(name, value.category, value.enabled ? 1 : 0, value.intent, JSON.stringify(value.config), value.ownerUserId);
      id = Number(result.lastInsertRowid);
    }
    db().prepare("INSERT INTO automatic_playlist_choices(owner_user_id,default_key,playlist_id) VALUES (?,?,?)").run(value.ownerUserId, key, id);
    return !existing;
  })();
}
export function removeUnusedAutomaticPlaylists(ownerUserId: number, keys: Set<string>) {
  const candidates = db().prepare(`SELECT p.id,c.default_key FROM smart_playlists p LEFT JOIN automatic_playlist_choices c ON c.playlist_id=p.id
    WHERE p.owner_user_id=? AND p.automatic=1 AND p.navidrome_playlist_id IS NULL AND p.last_run_at IS NULL`).all(ownerUserId) as Array<{ id: number; default_key: string | null }>;
  let removed = 0;
  db().transaction(() => {
    const ids = new Set(candidates.filter(item => item.default_key && keys.has(item.default_key)).map(item => item.id));
    for (const id of new Set(candidates.map(item => item.id))) if (!ids.has(id)) {
      // Retiring an unused suggestion is different from a listener dismissing it.
      db().prepare("DELETE FROM automatic_playlist_choices WHERE playlist_id=?").run(id);
      db().prepare("DELETE FROM smart_playlists WHERE id=?").run(id);
      removed++;
    }
  })();
  return removed;
}
