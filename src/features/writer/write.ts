import { copyFile,open,readFile,rename,rm,stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { extname } from "node:path";
import { promisify } from "node:util";
import { applyCoverArt,writeTagsBatch } from "taglib-wasm/simple";
import { db } from "@/features/db/client";
import type { DesiredTrackMetadata } from "@/features/contracts/types";
import { stableHash } from "@/features/scanner/normalize";
const run=promisify(execFile);
const nativeEnv={...process.env,LANG:"C.UTF-8",LC_ALL:"C.UTF-8"};
type FileRow={id:number;path:string;inode:number;size:number;mtime_ms:number;applied_hash:string|null;tags_json?:string};
function values(properties:Record<string,string[]>):string[]{const args:string[]=[];for(const[key,list]of Object.entries(properties)){args.push(`--remove-tag=${key}`);for(const value of list)if(value)args.push(`--set-tag=${key}=${value}`)}return args}
async function metaflac(args:string[]):Promise<string>{const result=await run("metaflac",args,{env:nativeEnv,timeout:10*60_000,maxBuffer:4*1024*1024});return result.stdout}
function equalValues(left:string[],right:string[]):boolean{return JSON.stringify(left.filter(Boolean).sort())===JSON.stringify(right.filter(Boolean).sort())}
async function flacMatches(path:string,properties:Record<string,string[]>):Promise<boolean>{const keys=Object.keys(properties),output=await metaflac([...keys.map(key=>`--show-tag=${key}`),path]),actual=new Map<string,string[]>();for(const line of output.split("\n")){const at=line.indexOf("=");if(at<1)continue;const key=line.slice(0,at).toUpperCase(),value=line.slice(at+1);(actual.get(key)??(actual.set(key,[]),actual.get(key)!)).push(value)}return keys.every(key=>equalValues(actual.get(key)??[],properties[key]??[]))}
function tagSnapshot(source:string|undefined,properties:Record<string,string[]>):string{const tags=source?JSON.parse(source) as Record<string,unknown>:{};const fields:Record<string,string>={TITLE:"title",ARTIST:"artist",ARTISTS:"artists",ALBUM:"album",ALBUMARTIST:"albumArtist",ALBUMARTISTS:"albumArtists",GENRE:"genre",COMPOSER:"composer",AUTHOR:"AUTHOR",STYLE:"style",MOOD:"mood",SCENE:"scene",ERA:"era"};for(const[property,field]of Object.entries(fields)){const list=properties[property];if(list)tags[field]=list.length===1?list[0]:list}return JSON.stringify(tags)}
function acknowledgeCuratorWrite(fileId:number):void{db().prepare("UPDATE track_profiles SET source_updated_at=(SELECT updated_at FROM files WHERE id=?) WHERE file_id=? AND NOT EXISTS (SELECT 1 FROM enrichments e WHERE e.entity_key=track_profiles.album_key AND datetime(e.created_at)>datetime(track_profiles.updated_at))").run(fileId,fileId)}
async function writeFlac(path:string,properties:Record<string,string[]>,coverPath?:string):Promise<void>{
  await metaflac([...values(properties),path]);
  if(!coverPath)return;
  await metaflac(["--remove","--block-type=PICTURE",path]);
  await metaflac([`--import-picture-from=${coverPath}`,path]);
}
async function writeMp3(path:string,properties:Record<string,string[]>,cover?:Buffer):Promise<void>{
  const result=await writeTagsBatch([{path,properties}],{concurrency:1,continueOnError:false});
  if(result.items[0]?.status==="error")throw result.items[0].error;
  if(!cover)return;
  const output=await applyCoverArt(path,cover,"image/jpeg"),handle=await open(path,"w");
  try{await handle.writeFile(output);await handle.sync()}finally{await handle.close()}
}
export async function writeMetadata(file:FileRow,desired:DesiredTrackMetadata):Promise<"written"|"unchanged">{
  const coverBytes=desired.coverPath?await readFile(desired.coverPath):undefined,desiredHash=stableHash({properties:desired.properties,cover:coverBytes?stableHash([...coverBytes.subarray(0,4096)]):null});
  if(file.applied_hash===desiredHash&&(extname(file.path).toLowerCase()!==".flac"||await flacMatches(file.path,desired.properties))){db().prepare("UPDATE files SET status='written',desired_hash=?,tags_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(desiredHash,tagSnapshot(file.tags_json,desired.properties),file.id);acknowledgeCuratorWrite(file.id);return"unchanged"}
  const current=await stat(file.path);if(Number(current.ino)!==file.inode||current.size!==file.size||current.mtimeMs!==file.mtime_ms)throw new Error("File changed after scan; rescan required");
  const temp=`${file.path}.curator-${process.pid}-${Date.now()}`;
  try{await copyFile(file.path,temp);if(extname(file.path).toLowerCase()===".flac")await writeFlac(temp,desired.properties,desired.coverPath);else await writeMp3(temp,desired.properties,coverBytes);const handle=await open(temp,"r+");await handle.sync();await handle.close();await rename(temp,file.path);const updated=await stat(file.path);db().prepare("UPDATE files SET inode=?,size=?,mtime_ms=?,desired_hash=?,applied_hash=?,tags_json=?,status='written',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(updated.ino),updated.size,updated.mtimeMs,desiredHash,desiredHash,tagSnapshot(file.tags_json,desired.properties),file.id);acknowledgeCuratorWrite(file.id);return"written"}finally{await rm(temp,{force:true})}
}
