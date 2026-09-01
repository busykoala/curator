import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { writeTagsBatch } from "taglib-wasm/simple";
import { db } from "../src/features/db/client";
import { acquireAlbumLease, releaseAlbumLease } from "../src/features/scheduler/album-lease";
import { mergeSemanticTagSnapshot, semanticTagProperties } from "../src/features/categorization/tags";
import { albumEvidence,loadAlbumFiles,sourceFingerprint } from "../src/features/categorization/context";

type Row = { id:number; album_key:string; path:string; format:string; link_count:number; tags_json:string; profile_json:string };
const run = (command:string,args:string[]) => new Promise<void>((resolve,reject) => {
  const child=spawn(command,args,{stdio:["ignore","ignore","pipe"],env:{...process.env,LANG:"C.UTF-8",LC_ALL:"C.UTF-8"}});let error="";
  child.stderr.on("data",chunk=>error+=String(chunk));child.on("error",reject);child.on("close",code=>code===0?resolve():reject(new Error(error||`${command} exited ${code}`)));
});
function args(properties:Record<string,string[]>):string[]{const output:string[]=[];for(const[tag,values]of Object.entries(properties)){output.push(`--remove-tag=${tag}`);for(const value of values)if(value)output.push(`--set-tag=${tag}=${value.replace(/[\r\n]+/g," ")}`)}return output}
async function write(row:Row,properties:Record<string,string[]>):Promise<void>{
  if(row.format.toLowerCase()==="flac")await run("metaflac",[...args(properties),row.path]);
  else{const result=await writeTagsBatch([{path:row.path,properties}],{concurrency:1,continueOnError:false});if(result.items[0]?.status==="error")throw result.items[0].error}
  const current=await stat(row.path),database=db(),snapshot=mergeSemanticTagSnapshot(row.tags_json,properties);
  database.transaction(()=>{database.prepare("UPDATE files SET size=?,mtime_ms=?,tags_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(current.size,current.mtimeMs,snapshot,row.id);database.prepare("UPDATE track_profiles SET source_updated_at=(SELECT updated_at FROM files WHERE id=?) WHERE file_id=?").run(row.id,row.id)})();
}
async function album(albumKey:string,rows:Row[]):Promise<{written:number;skipped:number;failed:number}>{
  if(!acquireAlbumLease(albumKey,"write"))return{written:0,skipped:rows.length,failed:0};let written=0,skipped=0,failed=0;const acknowledged:number[]=[];
  try{for(const row of rows){if(row.link_count!==1){skipped++;continue}try{const properties=semanticTagProperties(row.profile_json);if(!Object.keys(properties).length){skipped++;continue}await write(row,properties);acknowledged.push(row.id);written++}catch(error){failed++;console.error(JSON.stringify({event:"semantic_tag_failed",path:row.path,error:String(error)}))}}if(acknowledged.length){const evidence=albumEvidence(albumKey),files=new Map(loadAlbumFiles(albumKey).map(file=>[file.id,file])),update=db().prepare("UPDATE track_profiles SET source_fingerprint=?,source_updated_at=? WHERE file_id=?");db().transaction(()=>{for(const id of acknowledged){const file=files.get(id);if(file)update.run(sourceFingerprint(file,evidence),file.sourceUpdatedAt,id)}})()}}finally{releaseAlbumLease(albumKey,"write")}
  return{written,skipped,failed};
}
async function main():Promise<void>{
  const database=db(),version=(database.prepare("SELECT max(classifier_version) version FROM track_profiles").get() as{version:number}).version;
  const rows=database.prepare("SELECT f.id,f.album_key,f.path,f.format,f.link_count,f.tags_json,p.profile_json FROM files f JOIN track_profiles p ON p.file_id=f.id WHERE p.status='complete' AND p.classifier_version=? ORDER BY f.artist_name DESC,f.album_name DESC,f.path DESC").all(version) as Row[];
  const groups=new Map<string,Row[]>();for(const row of rows)(groups.get(row.album_key)??(groups.set(row.album_key,[]),groups.get(row.album_key)!)).push(row);
  const entries=[...groups.entries()];let written=0,skipped=0,failed=0;
  for(let at=0;at<entries.length;at+=16){const results=await Promise.all(entries.slice(at,at+16).map(([key,items])=>album(key,items)));for(const result of results){written+=result.written;skipped+=result.skipped;failed+=result.failed}console.log(JSON.stringify({event:"semantic_tag_progress",albums:Math.min(at+16,entries.length),totalAlbums:entries.length,written,skipped,failed}))}
  console.log(JSON.stringify({event:"semantic_tag_complete",albums:entries.length,written,skipped,failed,version}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
