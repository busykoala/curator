import { config } from "@/config";
import { db } from "@/features/db/client";

type TrackRow={file_id:number;title:string;artist:string;album:string;reason:string;retained:number;navidrome_song_id:string|null};
function tracks(playlistId:number,limit=8){return db().prepare(`SELECT i.file_id,coalesce(json_extract(f.tags_json,'$.title[0]'),json_extract(f.tags_json,'$.title'),replace(substr(f.path,instr(f.path,'/')+1),'.flac','')) title,f.artist_name artist,f.album_name album,i.reason,i.retained,i.navidrome_song_id FROM playlist_items i JOIN files f ON f.id=i.file_id WHERE i.run_id=(SELECT id FROM playlist_runs WHERE playlist_id=? AND status='complete' ORDER BY id DESC LIMIT 1) ORDER BY i.position LIMIT ?`).all(playlistId,limit) as TrackRow[]}
function moduleFor(ownerUserId:number,category:string){const playlist=db().prepare("SELECT id,name,navidrome_playlist_id FROM smart_playlists WHERE owner_user_id=? AND category=? ORDER BY enabled DESC,last_run_at DESC LIMIT 1").get(ownerUserId,category)as{id:number;name:string;navidrome_playlist_id:string|null}|undefined;return playlist?{...playlist,tracks:tracks(playlist.id)}:null}
export function homeData(userId:number){
  const tonight=db().prepare("SELECT id,name,category,navidrome_playlist_id,last_run_at FROM smart_playlists WHERE owner_user_id=? AND enabled=1 ORDER BY CASE WHEN last_run_at IS NULL THEN 1 ELSE 0 END,last_run_at DESC,id LIMIT 1").get(userId)as{id:number;name:string;category:string;navidrome_playlist_id:string|null;last_run_at:string|null}|undefined;
  const fresh=db().prepare("SELECT id fileId,artist_name artist,album_name album,updated_at updatedAt FROM files WHERE status='written' GROUP BY album_key ORDER BY updated_at DESC LIMIT 6").all();
  const requests=db().prepare("SELECT id,artist,album,status,updated_at updatedAt FROM music_requests WHERE requester_user_id=? ORDER BY updated_at DESC LIMIT 8").all(userId);
  const total=(db().prepare("SELECT count(*) count FROM files").get()as{count:number}).count;
  return{tonight:tonight?{...tonight,tracks:tracks(tonight.id,10)}:null,rediscover:moduleFor(userId,"rediscovery"),discovery:moduleFor(userId,"discovery"),depth:moduleFor(userId,"depth"),fresh,requests,libraryTracks:total,navidromePublicUrl:config.NAVIDROME_PUBLIC_URL};
}
