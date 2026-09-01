import { db } from "@/features/db/client";
import { definitionInputSchema,playlistConfigSchema,type PlaylistDefinition } from "./types";
import { nextZurichRunSql } from "./schedule-time";
type Row={id:number;name:string;category:string;enabled:number;intent:string;config_json:string;navidrome_playlist_id:string|null;last_run_at:string|null;next_run_at:string|null;created_at:string;updated_at:string};
function definition(row:Row):PlaylistDefinition{return{id:row.id,name:row.name,category:row.category as PlaylistDefinition["category"],enabled:Boolean(row.enabled),intent:row.intent,config:playlistConfigSchema.parse(JSON.parse(row.config_json)),navidromePlaylistId:row.navidrome_playlist_id,lastRunAt:row.last_run_at,nextRunAt:row.next_run_at,createdAt:row.created_at,updatedAt:row.updated_at}}
export function listPlaylists(){return(db().prepare("SELECT * FROM smart_playlists ORDER BY category,name").all() as Row[]).map(definition)}
export function getPlaylist(id:number){const row=db().prepare("SELECT * FROM smart_playlists WHERE id=?").get(id) as Row|undefined;return row?definition(row):undefined}
export function createPlaylist(input:unknown){const value=definitionInputSchema.parse(input),row=db().prepare("INSERT INTO smart_playlists(name,category,enabled,intent,config_json) VALUES (?,?,?,?,?) RETURNING *").get(value.name,value.category,value.enabled?1:0,value.intent,JSON.stringify(value.config)) as Row;return definition(row)}
export function updatePlaylist(id:number,input:unknown){const current=getPlaylist(id);if(!current)throw new Error("Playlist not found");const patch=typeof input==="object"&&input?input as Record<string,unknown>:{},value=definitionInputSchema.parse({...current,...patch,config:{...current.config,...((patch.config as object | undefined) ?? {})}}),row=db().prepare("UPDATE smart_playlists SET name=?,category=?,enabled=?,intent=?,config_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING *").get(value.name,value.category,value.enabled?1:0,value.intent,JSON.stringify(value.config),id) as Row;return definition(row)}
export function removePlaylist(id:number){db().prepare("DELETE FROM smart_playlists WHERE id=?").run(id)}
export function setNavidromeId(id:number,value:string){db().prepare("UPDATE smart_playlists SET navidrome_playlist_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(value,id)}
export function markRun(id:number){db().prepare("UPDATE smart_playlists SET last_run_at=CURRENT_TIMESTAMP,next_run_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(nextZurichRunSql(),id)}
export function refreshNextRunTimes(){const next=nextZurichRunSql();db().prepare("UPDATE smart_playlists SET next_run_at=? WHERE enabled=1 AND next_run_at IS NOT ?").run(next,next)}
export function playlistRuns(id:number){return db().prepare("SELECT id,status,preview,detail_json,error,started_at,finished_at FROM playlist_runs WHERE playlist_id=? ORDER BY id DESC LIMIT 12").all(id)}
export function feedback(id:number,fileId:number,artist:string,action:string){const scope=action==="snooze"?null:id;db().prepare("DELETE FROM playlist_feedback WHERE playlist_id IS ? AND file_id=? AND action IN ('pin','exclude','snooze')").run(scope,fileId);db().prepare(`INSERT INTO playlist_feedback(playlist_id,file_id,artist,action,expires_at) VALUES (?,?,?,?,${action==="snooze"?"datetime('now','+30 days')":"NULL"})`).run(scope,fileId,artist,action)}
export function dashboardData(){const definitions=listPlaylists();return{definitions:definitions.map(item=>({...item,runs:playlistRuns(item.id)})),clusters:db().prepare("SELECT id,label,terms_json,evidence_json,weight,updated_at FROM listening_clusters ORDER BY weight DESC,label").all(),acquisitions:db().prepare("SELECT * FROM discovery_candidates ORDER BY updated_at DESC LIMIT 80").all()}}

export function ensurePlaylist(input:unknown){
  const value=definitionInputSchema.parse(input);
  const result=db().prepare("INSERT INTO smart_playlists(name,category,enabled,intent,config_json) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM smart_playlists WHERE category=? AND name=?)").run(value.name,value.category,value.enabled?1:0,value.intent,JSON.stringify(value.config),value.category,value.name);
  return result.changes>0;
}
