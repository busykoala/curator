import { db } from "@/features/db/client";
export type ManualOverride={album_key:string;artist_name:string|null;album_name:string|null;release_date:string|null;artist_mbid:string|null;release_group_mbid:string|null;source_url?:string|null;confirmed:number};
function ensure():void{db().exec(`CREATE TABLE IF NOT EXISTS manual_overrides(album_key TEXT PRIMARY KEY,artist_name TEXT,album_name TEXT,release_date TEXT,artist_mbid TEXT,release_group_mbid TEXT,source_url TEXT,confirmed INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)}
export function getManualOverride(albumKey:string):ManualOverride|undefined{ensure();return db().prepare("SELECT * FROM manual_overrides WHERE album_key=?").get(albumKey) as ManualOverride|undefined}
export function verifiedSourceUrl(value:string|null|undefined):string|null{if(!value?.trim())return null;let url:URL;try{url=new URL(value.trim())}catch{throw new Error("Verified source must be a valid URL")}if(url.protocol!=="https:"||url.username||url.password)throw new Error("Verified source must be an https URL without credentials");url.hash="";return url.toString()}
export function saveManualOverride(value:Omit<ManualOverride,"confirmed">):void{ensure();const sourceUrl=verifiedSourceUrl(value.source_url);const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;if(value.artist_mbid&&!uuid.test(value.artist_mbid))throw new Error("Artist MusicBrainz ID must be a UUID");if(value.release_group_mbid&&!uuid.test(value.release_group_mbid))throw new Error("Release-group MusicBrainz ID must be a UUID");const confirmed=value.release_group_mbid||sourceUrl?1:0;db().prepare(`INSERT INTO manual_overrides(album_key,artist_name,album_name,release_date,artist_mbid,release_group_mbid,source_url,confirmed) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(album_key) DO UPDATE SET artist_name=excluded.artist_name,album_name=excluded.album_name,release_date=excluded.release_date,artist_mbid=excluded.artist_mbid,release_group_mbid=excluded.release_group_mbid,source_url=excluded.source_url,confirmed=excluded.confirmed,updated_at=CURRENT_TIMESTAMP`).run(value.album_key,value.artist_name,value.album_name,value.release_date,value.artist_mbid,value.release_group_mbid,sourceUrl,confirmed)}
/**
 * Merge a manual override's IDs into a searched identity. A confirmed override is authoritative:
 * only its own IDs may be written, so a near-miss catalogue search can never add a wrong
 * MusicBrainz ID to an album confirmed by a verified source page.
 */
export function applyManualIdentity(identity:{artistId?:string;releaseGroupId?:string},manual:Pick<ManualOverride,"artist_mbid"|"release_group_mbid"|"confirmed">|undefined):void{
  if(!manual)return;
  if(manual.confirmed){const searchedGroup=identity.releaseGroupId;identity.releaseGroupId=manual.release_group_mbid??undefined;identity.artistId=manual.artist_mbid??(identity.releaseGroupId&&searchedGroup===identity.releaseGroupId?identity.artistId:undefined);return}
  if(manual.artist_mbid)identity.artistId=manual.artist_mbid;
  if(manual.release_group_mbid)identity.releaseGroupId=manual.release_group_mbid;
}
