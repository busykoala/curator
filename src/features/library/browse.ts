import { createHash } from "node:crypto";
import { db } from "@/features/db/client";
import { navidromePlaylist,navidromePlaylists } from "@/features/integrations/navidrome";

export const browseViews = ["albums", "artists", "composers", "playlists", "years", "labels", "songs"] as const;
export type BrowseView = typeof browseViews[number];
type FileRow = { id:number; path:string; album_key:string; artist_name:string; album_name:string; status:string; tags_json:string; updated_at:string };
type TagMap = Record<string, unknown>;

const list = (value:unknown):string[] => Array.isArray(value) ? value.map(String).filter(Boolean) : value ? [String(value)] : [];
const scalar = (value:unknown):string => list(value)[0] ?? "";
const tags = (row:FileRow):TagMap => { try { return JSON.parse(row.tags_json) as TagMap; } catch { return {}; } };
const extras = (tag:TagMap):TagMap => typeof tag.extraProperties === "object" && tag.extraProperties ? tag.extraProperties as TagMap : {};
const values = (tag:TagMap,...keys:string[]):string[] => [...new Set(keys.flatMap(key=>list(tag[key] ?? extras(tag)[key.toUpperCase()])))];
const title = (row:FileRow):string => scalar(tags(row).title) || row.path.split("/").pop() || "Untitled";
const year = (row:FileRow):string => String(tags(row).year ?? tags(row).date ?? "").slice(0,4);
const artToken = (row:FileRow,kind:"album"|"artist") => `/api/library/artwork?fileId=${row.id}&kind=${kind}&v=${encodeURIComponent(row.updated_at)}`;
const keyFor = (value:string) => createHash("sha1").update(value).digest("hex").slice(0,12);

function allRows(query:string):FileRow[] {
  const q=`%${query.trim().toLowerCase()}%`;
  return db().prepare(`SELECT id,path,album_key,artist_name,album_name,status,tags_json,updated_at FROM files WHERE ?='' OR lower(artist_name) LIKE ? OR lower(album_name) LIKE ? OR lower(tags_json) LIKE ? ORDER BY artist_name,album_name,path`).all(query.trim()?"x":"",q,q,q) as FileRow[];
}

export async function browseLibrary(view:BrowseView,query:string,page:number,pageSize:number) {
  if(view==="playlists"){const playlists=await navidromePlaylists();if(!playlists)return {view,items:[],total:0,page,pageSize,message:"Connect Navidrome in Settings to browse server playlists here."};const filtered=playlists.filter(item=>item.title.toLowerCase().includes(query.toLowerCase())),start=(Math.max(1,page)-1)*pageSize;return{view,items:filtered.slice(start,start+pageSize),total:filtered.length,page,pageSize}}
  if(view==="songs"){const value=query.trim(),q=`%${value.toLowerCase()}%`,where="(?='' OR lower(artist_name) LIKE ? OR lower(album_name) LIKE ? OR lower(tags_json) LIKE ?)",parameters=[value?"x":"",q,q,q],total=(db().prepare(`SELECT count(*) count FROM files WHERE ${where}`).get(...parameters) as{count:number}).count,offset=(Math.max(1,page)-1)*pageSize,rows=db().prepare(`SELECT id,path,album_key,artist_name,album_name,status,tags_json,updated_at FROM files WHERE ${where} ORDER BY artist_name,album_name,path LIMIT ? OFFSET ?`).all(...parameters,pageSize,offset) as FileRow[],items=rows.map(row=>({key:String(row.id),token:keyFor(String(row.id)),title:title(row),subtitle:`${row.artist_name} / ${row.album_name}`,count:1,year:year(row),status:row.status==="error"?"error":row.status!=="written"?"processing":"ready",artwork:artToken(row,"album"),fileId:row.id}));return{view,items,total,page:Math.max(1,page),pageSize}}
  const rows=allRows(query),groups=new Map<string,FileRow[]>();
  for(const row of rows){
    const tag=tags(row),groupValues=view==="albums"?[row.album_key]:view==="artists"?[row.artist_name]:view==="composers"?values(tag,"composer","composers","author"):view==="years"?[year(row)]:values(tag,"label","publisher","recordlabel","organization");
    for(const value of groupValues.filter(Boolean)){const existing=groups.get(value)??[];existing.push(row);groups.set(value,existing)}
  }
  const items=[...groups.entries()].map(([key,group])=>{
    const first=group[0],tag=tags(first),display=view==="albums"?first.album_name:key;
    return {key,token:keyFor(key),title:display,subtitle:view==="albums"?first.artist_name:`${group.length} track${group.length===1?"":"s"}`,count:group.length,year:year(first),status:group.some(row=>row.status==="error")?"error":group.some(row=>row.status!=="written")?"processing":"ready",artwork:view==="artists"||view==="composers"?artToken(first,"artist"):artToken(first,"album"),fileId:first.id};
  }).sort((a,b)=>a.title.localeCompare(b.title,undefined,{numeric:true,sensitivity:"base"}));
  const start=(Math.max(1,page)-1)*pageSize;
  return {view,items:items.slice(start,start+pageSize),total:items.length,page:Math.max(1,page),pageSize};
}

export async function libraryEntity(view:BrowseView,key:string) {
  if(view==="playlists")return navidromePlaylist(key);
  const rows=allRows("").filter(row=>{
    const tag=tags(row);
    if(view==="albums")return row.album_key===key;
    if(view==="artists")return row.artist_name===key;
    if(view==="composers")return values(tag,"composer","composers","author").includes(key);
    if(view==="years")return year(row)===key;
    if(view==="labels")return values(tag,"label","publisher","recordlabel","organization").includes(key);
    return view==="songs"&&String(row.id)===key;
  });
  if(!rows.length)return null;
  const first=rows[0],firstTags=tags(first);
  const tracks=rows.map(row=>{const tag=tags(row),profile=db().prepare("SELECT profile_json,manual_json,status,updated_at FROM track_profiles WHERE file_id=?").get(row.id) as {profile_json:string;manual_json:string;status:string;updated_at:string}|undefined;return{id:row.id,title:title(row),artist:row.artist_name,album:row.album_name,track:Number(tag.track??tag.trackNumber??0),disc:Number(tag.disc??tag.discNumber??0),year:year(row),path:row.path,status:row.status,tags:tag,profile:profile?JSON.parse(profile.profile_json):null,manual:profile?JSON.parse(profile.manual_json):null,profileStatus:profile?.status??"missing"}}).sort((a,b)=>a.disc-b.disc||a.track-b.track||a.title.localeCompare(b.title));
  return {view,key,title:view==="albums"?first.album_name:view==="songs"?title(first):key,subtitle:view==="albums"?first.artist_name:`${rows.length} track${rows.length===1?"":"s"}`,artwork:view==="artists"||view==="composers"?artToken(first,"artist"):artToken(first,"album"),summary:{artist:first.artist_name,album:first.album_name,year:year(first),genres:values(firstTags,"genre"),styles:values(firstTags,"style"),moods:values(firstTags,"mood"),scenes:values(firstTags,"scene"),labels:values(firstTags,"label","publisher","recordlabel")},tracks};
}

export function ensureMetadataOverrides():void {
  db().exec("CREATE TABLE IF NOT EXISTS file_metadata_overrides(file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,patch_json TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
}
