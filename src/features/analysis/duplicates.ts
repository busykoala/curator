import { basename,dirname } from "node:path";
import { db } from "@/features/db/client";
import { normalized } from "@/features/scanner/normalize";
type Row={album_key:string;artist_name:string;album_name:string;path:string;tags_json:string};
function scalar(tags:Record<string,unknown>,...keys:string[]):string{for(const key of keys){const value=tags[key];if(value!=null){const found=Array.isArray(value)?value[0]:value;if(found!=null&&String(found))return String(found)}}return""}
function albumRoot(path:string):string{const dir=dirname(path);return/^(?:(?:digital\s+media|8cm\s+cd|cd|disc|disk|part)[\s._-]*\d+)$/i.test(basename(dir))?dirname(dir):dir}
function agreement(a:Set<string>,b:Set<string>):number{if(!a.size||!b.size)return 0;let shared=0;for(const item of a)if(b.has(item))shared++;return shared/Math.max(a.size,b.size)}
const fieldKeys={albumArtist:["albumArtist","ALBUMARTIST"],releaseDate:["releaseDate","RELEASEDATE","date","DATE"],compilation:["compilation","COMPILATION"],discTotal:["discTotal","DISCTOTAL"],albumSort:["albumSort","ALBUMSORT"],mbid:["musicbrainzReleaseGroupId","MUSICBRAINZ_RELEASEGROUPID"]} as const;
const extraKeys={albumArtist:"ALBUMARTIST",releaseDate:"RELEASEDATE",compilation:"COMPILATION",discTotal:"DISCTOTAL",albumSort:"ALBUMSORT",mbid:"MUSICBRAINZ_RELEASEGROUPID"} as const;
function canonical(files:Row[],field:keyof typeof fieldKeys):string{
  const counts=new Map<string,number>();
  for(const file of files){const value=scalar(JSON.parse(file.tags_json),...fieldKeys[field]);if(value)counts.set(value,(counts.get(value)||0)+1)}
  return[...counts].sort((a,b)=>b[1]-a[1]||(field==="releaseDate"?b[0].length-a[0].length:0)||a[0].localeCompare(b[0]))[0]?.[0]||""
}
function harmonize(files:Row[]):void{
  const chosen=Object.fromEntries((Object.keys(fieldKeys) as Array<keyof typeof fieldKeys>).map(field=>[field,canonical(files,field)])) as Record<keyof typeof fieldKeys,string>,update=db().prepare("UPDATE files SET tags_json=?,status='analyzed',desired_hash=NULL,updated_at='1970-01-01' WHERE path=?");
  for(const file of files){const tags=JSON.parse(file.tags_json) as Record<string,unknown>,extra={...((tags.extraProperties as Record<string,unknown>)||{})};for(const field of Object.keys(fieldKeys) as Array<keyof typeof fieldKeys>){const value=chosen[field];if(!value)continue;const key=fieldKeys[field][0];tags[key]=key==="releaseDate"||key==="discTotal"?value:[value];extra[extraKeys[field]]=[value]}tags.extraProperties=extra;update.run(JSON.stringify(tags),file.path)}
}
export function detectDuplicates():number{
  const rows=db().prepare("SELECT album_key,artist_name,album_name,path,tags_json FROM files").all() as Row[],groups=new Map<string,Row[]>();
  for(const row of rows)(groups.get(row.album_key)??(groups.set(row.album_key,[]),groups.get(row.album_key)!)).push(row);
  const previous=new Map((db().prepare("SELECT group_key,status,detail_json FROM duplicate_groups").all() as Array<{group_key:string;status:string;detail_json:string}>).map(row=>[row.group_key,row]));db().prepare("UPDATE duplicate_groups SET status='resolved',updated_at=CURRENT_TIMESTAMP").run();let found=0;
  for(const files of groups.values()){
    const roots=new Set(files.map(file=>albumRoot(file.path))),fields={albumArtist:new Set<string>(),releaseDate:new Set<string>(),compilation:new Set<string>(),discTotal:new Set<string>(),albumSort:new Set<string>(),mbid:new Set<string>()},titles=new Map<string,Set<string>>();
    for(const file of files){const tags=JSON.parse(file.tags_json) as Record<string,unknown>,root=albumRoot(file.path);fields.albumArtist.add(scalar(tags,"albumArtist","ALBUMARTIST"));fields.releaseDate.add(scalar(tags,"releaseDate","RELEASEDATE","date","DATE"));fields.compilation.add(scalar(tags,"compilation","COMPILATION"));fields.discTotal.add(scalar(tags,"discTotal","DISCTOTAL"));fields.albumSort.add(scalar(tags,"albumSort","ALBUMSORT"));fields.mbid.add(scalar(tags,"musicbrainzReleaseGroupId","MUSICBRAINZ_RELEASEGROUPID"));(titles.get(root)??(titles.set(root,new Set()),titles.get(root)!)).add(normalized(scalar(tags,"title","TITLE")))}
    const conflicts=Object.entries(fields).filter(([,values])=>values.size>1).map(([name])=>name);if(!conflicts.length)continue;
    const titleSets=[...titles.values()],trackAgreement=titleSets.length<2?1:Math.max(...titleSets.flatMap((a,index)=>titleSets.slice(index+1).map(b=>agreement(a,b)))),ids=[...fields.mbid].filter(Boolean),sharedMbid=ids.length===1,repairable=roots.size===1||sharedMbid||trackAgreement>=.9,first=files[0],status=repairable?"open":"blocked",confidence=roots.size===1?.98:sharedMbid?1:trackAgreement;
    const detail={directories:[...roots],conflicts,releaseDates:[...fields.releaseDate],releaseGroupIds:[...fields.mbid],trackAgreement,tracks:files.length},detailJson=JSON.stringify(detail),groupKey=`${normalized(first.artist_name)}:${normalized(first.album_name)}`,prior=previous.get(groupKey),shouldQueue=repairable&&(!prior||prior.status==="resolved"||prior.detail_json!==detailJson);
    if(repairable)harmonize(files);
    db().prepare("INSERT INTO duplicate_groups(group_key,artist,album,kind,confidence,status,detail_json) VALUES (?,?,?,?,?,?,?) ON CONFLICT(group_key) DO UPDATE SET kind=excluded.kind,confidence=excluded.confidence,status=excluded.status,detail_json=excluded.detail_json,updated_at=CURRENT_TIMESTAMP").run(groupKey,first.artist_name,first.album_name,roots.size>1?"cross-directory":"split-grouping",confidence,repairable?"merging":status,JSON.stringify(detail));
    if(shouldQueue)db().prepare("UPDATE files SET status='analyzed',updated_at='1970-01-01' WHERE album_key=? AND status='written'").run(first.album_key);found++;
  }
  return found;
}
