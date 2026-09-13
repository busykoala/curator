import { createHash } from "node:crypto";
import { db } from "@/features/db/client";
import { navidromePlaylist,navidromePlaylists } from "@/features/integrations/navidrome";
export const browseViews=["albums","artists","composers","playlists","years","labels","songs"]as const;
export type BrowseView=typeof browseViews[number];
type FileRow={id:number;path:string;album_key:string;artist_name:string;album_name:string;status:string;tags_json:string;updated_at:string};
type TagMap=Record<string,unknown>;
const list=(value:unknown):string[]=>Array.isArray(value)?value.map(String).filter(Boolean):value?[String(value)]:[];
const scalar=(value:unknown):string=>list(value)[0]??"";
const tags=(row:FileRow):TagMap=>{try{return JSON.parse(row.tags_json)as TagMap}catch{return{}}};
const extras=(tag:TagMap):TagMap=>typeof tag.extraProperties==="object"&&tag.extraProperties?tag.extraProperties as TagMap:{};
const values=(tag:TagMap,...keys:string[]):string[]=>[...new Set(keys.flatMap(key=>list(tag[key]??extras(tag)[key.toUpperCase()])))];
const title=(row:FileRow):string=>scalar(tags(row).title)||row.path.split("/").pop()||"Untitled";
const year=(row:FileRow):string=>String(tags(row).year??tags(row).date??"").slice(0,4);
const artToken=(row:Pick<FileRow,"id"|"updated_at">,kind:"album"|"artist")=>`/api/library/artwork?fileId=${row.id}&kind=${kind}&v=${encodeURIComponent(row.updated_at)}`;
const keyFor=(value:string)=>createHash("sha1").update(value).digest("hex").slice(0,12);
const fts=(query:string)=>query.trim().split(/\s+/).map(value=>`"${value.replaceAll('"','""')}"*`).join(" AND ");
function searchWhere(query:string,alias="f"){return query.trim()?{sql:`${alias}.id IN (SELECT CAST(file_id AS INTEGER) FROM files_search WHERE files_search MATCH ?)`,params:[fts(query)]}:{sql:"1=1",params:[]}}
function allRows(query:string):FileRow[]{const where=searchWhere(query);return db().prepare(`SELECT id,path,album_key,artist_name,album_name,status,tags_json,updated_at FROM files f WHERE ${where.sql} ORDER BY artist_name,album_name,path`).all(...where.params)as FileRow[]}

export async function browseLibrary(view:BrowseView,query:string,page:number,pageSize:number){
  if(view==="playlists"){const playlists=await navidromePlaylists();if(!playlists)return{view,items:[],total:0,page,pageSize,message:"Navidrome service access is not configured."};const filtered=playlists.filter(item=>item.title.toLowerCase().includes(query.toLowerCase())),start=(Math.max(1,page)-1)*pageSize;return{view,items:filtered.slice(start,start+pageSize),total:filtered.length,page,pageSize}}
  const offset=(Math.max(1,page)-1)*pageSize,where=searchWhere(query);
  if(view==="songs"){const total=(db().prepare(`SELECT count(*) count FROM files f WHERE ${where.sql}`).get(...where.params)as{count:number}).count,rows=db().prepare(`SELECT id,path,album_key,artist_name,album_name,status,tags_json,updated_at FROM files f WHERE ${where.sql} ORDER BY artist_name,album_name,path LIMIT ? OFFSET ?`).all(...where.params,pageSize,offset)as FileRow[],items=rows.map(row=>({key:String(row.id),token:keyFor(String(row.id)),title:title(row),subtitle:`${row.artist_name} / ${row.album_name}`,count:1,year:year(row),status:row.status==="error"?"error":row.status!=="written"?"processing":"ready",artwork:artToken(row,"album"),fileId:row.id}));return{view,items,total,page:Math.max(1,page),pageSize}}
  if(view==="albums"||view==="artists"){
    const field=view==="albums"?"album_key":"artist_name",total=(db().prepare(`SELECT count(DISTINCT ${field}) count FROM files f WHERE ${where.sql}`).get(...where.params)as{count:number}).count;
    const rows=db().prepare(`SELECT min(id) id,min(path) path,${field} group_key,min(album_name) album_name,min(artist_name) artist_name,count(*) count,min(updated_at) updated_at,sum(status='error') errors,sum(status!='written') pending FROM files f WHERE ${where.sql} GROUP BY ${field} ORDER BY ${view==="albums"?"album_name":"artist_name"} COLLATE NOCASE LIMIT ? OFFSET ?`).all(...where.params,pageSize,offset)as Array<{id:number;path:string;group_key:string;album_name:string;artist_name:string;count:number;updated_at:string;errors:number;pending:number}>;
    const items=rows.map(row=>({key:row.group_key,token:keyFor(row.group_key),title:view==="albums"?row.album_name:row.artist_name,subtitle:view==="albums"?row.artist_name:`${row.count} track${row.count===1?"":"s"}`,count:row.count,year:"",status:row.errors?"error":row.pending?"processing":"ready",artwork:artToken(row,view==="artists"?"artist":"album"),fileId:row.id}));return{view,items,total,page:Math.max(1,page),pageSize};
  }
  const rows=allRows(query),groups=new Map<string,FileRow[]>();
  for(const row of rows){const tag=tags(row),groupValues=view==="composers"?values(tag,"composer","composers","author"):view==="years"?[year(row)]:values(tag,"label","publisher","recordlabel","organization");for(const value of groupValues.filter(Boolean)){const existing=groups.get(value)??[];existing.push(row);groups.set(value,existing)}}
  const items=[...groups.entries()].map(([key,group])=>{const first=group[0];return{key,token:keyFor(key),title:key,subtitle:`${group.length} track${group.length===1?"":"s"}`,count:group.length,year:year(first),status:group.some(row=>row.status==="error")?"error":group.some(row=>row.status!=="written")?"processing":"ready",artwork:view==="composers"?artToken(first,"artist"):artToken(first,"album"),fileId:first.id}}).sort((a,b)=>a.title.localeCompare(b.title,undefined,{numeric:true,sensitivity:"base"}));const start=(Math.max(1,page)-1)*pageSize;return{view,items:items.slice(start,start+pageSize),total:items.length,page:Math.max(1,page),pageSize};
}

export async function libraryEntity(view:BrowseView,key:string){
  if(view==="playlists")return navidromePlaylist(key);
  let rows:FileRow[];
  if(view==="albums")rows=db().prepare("SELECT id,path,album_key,artist_name,album_name,status,tags_json,updated_at FROM files WHERE album_key=? ORDER BY path").all(key)as FileRow[];
  else if(view==="artists")rows=db().prepare("SELECT id,path,album_key,artist_name,album_name,status,tags_json,updated_at FROM files WHERE artist_name=? ORDER BY album_name,path").all(key)as FileRow[];
  else if(view==="songs")rows=db().prepare("SELECT id,path,album_key,artist_name,album_name,status,tags_json,updated_at FROM files WHERE id=?").all(Number(key))as FileRow[];
  else rows=allRows("").filter(row=>{const tag=tags(row);if(view==="composers")return values(tag,"composer","composers","author").includes(key);if(view==="years")return year(row)===key;return values(tag,"label","publisher","recordlabel","organization").includes(key)});
  if(!rows.length)return null;const first=rows[0],firstTags=tags(first),tracks=rows.map(row=>{const tag=tags(row),profile=db().prepare("SELECT profile_json,manual_json,status FROM track_profiles WHERE file_id=?").get(row.id)as{profile_json:string;manual_json:string;status:string}|undefined;return{id:row.id,title:title(row),artist:row.artist_name,album:row.album_name,track:Number(tag.track??tag.trackNumber??0),disc:Number(tag.disc??tag.discNumber??0),year:year(row),path:row.path,status:row.status,tags:tag,profile:profile?JSON.parse(profile.profile_json):null,manual:profile?JSON.parse(profile.manual_json):null,profileStatus:profile?.status??"missing"}}).sort((a,b)=>a.disc-b.disc||a.track-b.track||a.title.localeCompare(b.title));return{view,key,title:view==="albums"?first.album_name:view==="songs"?title(first):key,subtitle:view==="albums"?first.artist_name:`${rows.length} track${rows.length===1?"":"s"}`,artwork:view==="artists"||view==="composers"?artToken(first,"artist"):artToken(first,"album"),summary:{artist:first.artist_name,album:first.album_name,year:year(first),genres:values(firstTags,"genre"),styles:values(firstTags,"style"),moods:values(firstTags,"mood"),scenes:values(firstTags,"scene"),labels:values(firstTags,"label","publisher","recordlabel")},tracks};
}
export function ensureMetadataOverrides():void{db().exec("CREATE TABLE IF NOT EXISTS file_metadata_overrides(file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,patch_json TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")}
