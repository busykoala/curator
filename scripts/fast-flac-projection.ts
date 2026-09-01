import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { db, stateGet } from "@/features/db/client";
import { semanticTagProperties } from "@/features/categorization/tags";
import { albumEvidence, loadAlbumFiles, sourceFingerprint } from "@/features/categorization/context";
import { aggregateAlbum } from "@/features/categorization/aggregate";

type Row={id:number;path:string;album_key:string;artist_name:string;tags_json:string;profile_json:string};
type Values=Record<string,string[]>;
const scalar=(tags:Record<string,unknown>,...keys:string[]):string=>{for(const key of keys){const value=tags[key],first=Array.isArray(value)?value[0]:value;if(first!=null&&String(first).trim())return String(first).trim()}return""};
const list=(tags:Record<string,unknown>,...keys:string[]):string[]=>{for(const key of keys){const value=tags[key];if(Array.isArray(value)&&value.length)return value.map(String).filter(Boolean);if(value!=null&&String(value).trim())return[String(value).trim()]}return[]};

function desired(row:Row):Values{
  const tags=JSON.parse(row.tags_json) as Record<string,unknown>,extra=(tags.extraProperties as Record<string,unknown>)||{},semantic=semanticTagProperties(row.profile_json),album=scalar(tags,"album","ALBUM"),albumArtist=scalar(tags,"albumArtist","ALBUMARTIST")||row.artist_name,date=scalar(tags,"releaseDate","RELEASEDATE","date","DATE"),releaseGroup=list(tags,"musicbrainzReleaseGroupId","MUSICBRAINZ_RELEASEGROUPID").length?list(tags,"musicbrainzReleaseGroupId","MUSICBRAINZ_RELEASEGROUPID"):list(extra,"MUSICBRAINZ_RELEASEGROUPID"),artistIds=list(tags,"musicbrainzArtistId","MUSICBRAINZ_ARTISTID").length?list(tags,"musicbrainzArtistId","MUSICBRAINZ_ARTISTID"):list(extra,"MUSICBRAINZ_ARTISTID");
  return{...semantic,ALBUM:[album].filter(Boolean),ALBUMARTIST:[albumArtist],DATE:[date].filter(Boolean),RELEASEDATE:[date].filter(Boolean),MUSICBRAINZ_RELEASEGROUPID:releaseGroup,MUSICBRAINZ_ARTISTID:artistIds};
}

function project(path:string,properties:Values):Promise<void>{
  const args:string[]=[];
  for(const[key,values]of Object.entries(properties)){args.push(`--remove-tag=${key}`);for(const value of [...new Set(values.map(String).map(item=>item.trim()).filter(Boolean))])args.push(`--set-tag=${key}=${value}`)}
  args.push("--",path);
  return new Promise((resolve,reject)=>{const child=spawn("metaflac",args,{stdio:["ignore","ignore","pipe"]}),errors:string[]=[];child.stderr.on("data",chunk=>errors.push(String(chunk)));child.once("error",reject);child.once("close",code=>code===0?resolve():reject(new Error(errors.join("").trim()||`metaflac exited ${code}`)))})
}

async function worker(queue:Row[],success:Set<number>,failures:Array<{path:string;error:string}>):Promise<void>{
  for(;;){const row=queue.pop();if(!row)return;try{await project(row.path,desired(row));const info=await stat(row.path),properties=desired(row),tags=JSON.parse(row.tags_json) as Record<string,unknown>,extra={...((tags.extraProperties as Record<string,unknown>)||{})};for(const[key,values]of Object.entries(properties)){tags[key]=values;extra[key]=values}tags.album=properties.ALBUM;tags.albumArtist=properties.ALBUMARTIST;tags.releaseDate=properties.RELEASEDATE?.[0]||tags.releaseDate;tags.genre=properties.GENRE;tags.style=properties.STYLE;tags.mood=properties.MOOD;tags.scene=properties.SCENE;tags.extraProperties=extra;db().prepare("UPDATE files SET tags_json=?,inode=?,link_count=?,size=?,mtime_ms=?,status='written',desired_hash=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify(tags),Number(info.ino),Number(info.nlink),Number(info.size),info.mtimeMs,row.id);success.add(row.id)}catch(error){failures.push({path:row.path,error:String(error)})}}
}

async function main():Promise<void>{
  if(stateGet("paused")!=="true")throw new Error("Curator must be paused");
  const active=(db().prepare("SELECT count(*) n FROM files WHERE status='processing'").get() as{n:number}).n;if(active)throw new Error(`${active} files are still processing`);
  const rows=db().prepare("SELECT f.id,f.path,f.album_key,f.artist_name,f.tags_json,p.profile_json FROM files f JOIN track_profiles p ON p.file_id=f.id WHERE f.status='analyzed' AND lower(f.format)='flac' AND f.link_count=1 AND p.status='complete'").all() as Row[],queue=[...rows],success=new Set<number>(),failures:Array<{path:string;error:string}>=[];
  await Promise.all(Array.from({length:Math.min(6,rows.length)},()=>worker(queue,success,failures)));
  const albumKeys=[...new Set(rows.filter(row=>success.has(row.id)).map(row=>row.album_key))];
  for(const albumKey of albumKeys){const evidence=albumEvidence(albumKey),files=loadAlbumFiles(albumKey),update=db().prepare("UPDATE track_profiles SET source_fingerprint=?,source_updated_at=(SELECT updated_at FROM files WHERE id=?),updated_at=CURRENT_TIMESTAMP WHERE file_id=?");for(const file of files)if(success.has(file.id))update.run(sourceFingerprint(file,evidence),file.id,file.id);aggregateAlbum(albumKey)}
  console.log(JSON.stringify({eligible:rows.length,written:success.size,failed:failures.length,failures:failures.slice(0,20)}));
}

void main().catch(error=>{console.error(error);process.exitCode=1});
