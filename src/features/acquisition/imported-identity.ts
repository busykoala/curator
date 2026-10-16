import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {copyFile,realpath,rename,rm,stat,open} from 'node:fs/promises';
import {dirname,extname,relative,resolve,isAbsolute,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {config} from '@/config';
import {db,stateGet,stateSet} from '@/features/db/client';
import {album,artist,releaseTracks,trackFiles} from './lidarr';
import {rescanFolders} from '@/features/sources/lidarr';
import {refreshLibrary} from '@/features/integrations/navidrome';
const run=promisify(execFile);
type IdentityJob={albumId:number;artistId:number;releaseId:number;artist:string;album:string;trackIds:number[]};
const jobKey=(id:number)=>`acquisition_identity_pending:${id}`;
export function queueImportedIdentity(job:IdentityJob){
  if(!job.artist.trim()||!job.album.trim()||!job.trackIds.length||new Set(job.trackIds).size!==job.trackIds.length)throw Error('Incomplete imported identity');
  stateSet(jobKey(job.albumId),JSON.stringify(job));
}
export function libraryImportPath(nativePath:string){
  const path=relative(config.LIDARR_MUSIC_ROOT,nativePath);
  if(!path||path==='..'||path.startsWith('../')||isAbsolute(path))throw Error('Imported file is outside the library');
  return resolve(config.MUSIC_ROOT,path);
}
export function missingIdentityProperties(tags:Record<string,unknown>,expected:Record<string,string>){
  const missing:Record<string,string[]>={};
  for(const [name,value] of Object.entries(expected)){
    const existing=tags[name],values=Array.isArray(existing)?existing:[existing];
    if(!values.some(v=>v!==undefined&&v!==null&&String(v).trim()&&String(v)!=='0'))missing[name]=[value];
  }
  return missing;
}
type TagIO={read:(path:string)=>Promise<Record<string,unknown>>;write:(path:string,properties:Record<string,string[]>)=>Promise<void>};
const tagIO:TagIO={async read(actual){
  let tags:Record<string,unknown>={};
  const flac=extname(actual).toLowerCase()==='.flac';
  if(flac){const {stdout}=await run('metaflac',['--export-tags-to=-',actual],{timeout:30000,maxBuffer:2*1024*1024});for(const line of stdout.split('\n')){const at=line.indexOf('=');if(at>0){const key=line.slice(0,at).toUpperCase();tags[key]=[...(tags[key] as string[]??[]),line.slice(at+1)]}}}
  else{
    const {readTags}=await import('taglib-wasm/simple'),read=await readTags(actual);
    tags={TITLE:read.title,ARTIST:read.artist,ALBUM:read.album,ALBUMARTIST:read.albumArtist,TRACKNUMBER:read.track,DISCNUMBER:read.discNumber};
  }
  return tags;
},async write(path,properties){
  if(extname(path).toLowerCase()==='.flac')await run('metaflac',[...Object.entries(properties).flatMap(([k,v])=>[`--remove-tag=${k}`,`--set-tag=${k}=${v[0]}`]),path],{timeout:30000});
  else{const {writeTagsBatch}=await import('taglib-wasm/simple');const result=await writeTagsBatch([{path,properties}],{concurrency:1,continueOnError:false});if(result.items[0]?.status==='error')throw result.items[0].error}
}};
export async function repairImportedFile(path:string,expected:Record<string,string>,io=tagIO){
  const root=await realpath(config.MUSIC_ROOT),actual=await realpath(path);
  if(!actual.startsWith(root+sep))throw Error('Imported file resolves outside the library');
  const before=await stat(actual);
  if(!before.isFile())throw Error('Imported path is not a file');
  const properties=missingIdentityProperties(await io.read(actual),expected);
  if(!Object.keys(properties).length)return false;
  const temp=actual.slice(0,-extname(actual).length)+'.curator-recovery-'+randomUUID()+extname(actual);
  try{
    // Copy and replace the library file: even a historical hardlink cannot
    // mutate a torrent's original bytes, and a failed write leaves audio intact.
    await copyFile(actual,temp);
    await io.write(temp,properties);
    const current=await stat(actual);if(current.size!==before.size||current.mtimeMs!==before.mtimeMs)throw Error('Imported file changed during identity repair');
    const handle=await open(temp,'r+');try{await handle.sync()}finally{await handle.close()}
    await rename(temp,actual);return true;
  }finally{await rm(temp,{force:true})}
}
async function backfillProvenImports(){
  if(stateGet('acquisition_identity_backfilled_v1'))return;
  const rows=db().prepare("SELECT DISTINCT a.lidarr_album_id id FROM download_interventions i JOIN acquisition_targets a ON a.id=i.target_id WHERE i.action='manual-import' AND i.status='applied' AND json_extract(i.evidence_json,'$.recovery') IS NOT NULL AND i.created_at>=datetime('now','-7 days')").all() as {id:number}[];
  for(const row of rows){
    if(stateGet(jobKey(row.id))||stateGet(`acquisition_identity_done:${row.id}`))continue;
    const a=await album(row.id),release=a.releases?.find(r=>r.monitored);
    if(!release?.id||Number(a.statistics?.percentOfTracks??0)<100)continue;
    const ar=await artist(a.artistId),tracks=await releaseTracks(release.id);
    queueImportedIdentity({albumId:a.id,artistId:a.artistId,releaseId:release.id,artist:String(ar.artistName),album:a.title,trackIds:tracks.map(t=>t.id)});
  }
  stateSet('acquisition_identity_backfilled_v1','true');
}
export async function recoverImportedIdentities(){
  await backfillProvenImports();
  const jobs=db().prepare("SELECT key,value FROM state WHERE key LIKE 'acquisition_identity_pending:%' ORDER BY updated_at LIMIT 3").all() as {key:string;value:string}[];
  for(const saved of jobs)try{
    const job=JSON.parse(saved.value) as IdentityJob,a=await album(job.albumId);
    if(a.artistId!==job.artistId)throw Error('Imported album identity changed');
    const tracks=await releaseTracks(job.releaseId);
    if(!job.trackIds.length||tracks.length!==job.trackIds.length||tracks.some(t=>!job.trackIds.includes(t.id)||!t.hasFile||!t.trackFileId)){stateSet(saved.key,saved.value);continue}
    const files=await trackFiles(job.albumId),folders=new Set<string>();let repaired=0;
    for(const track of tracks){
      const file=files.find(f=>f.id===track.trackFileId);
      if(!file||file.albumId!==job.albumId)throw Error('Imported file identity is unavailable');
      const path=libraryImportPath(file.path);
      folders.add(dirname(path));
      if(await repairImportedFile(path,{TITLE:track.title,ARTIST:job.artist,ALBUMARTIST:job.artist,ALBUM:job.album,TRACKNUMBER:String(track.absoluteTrackNumber),DISCNUMBER:String(track.mediumNumber)}))repaired++;
    }
    if(folders.size)await rescanFolders([...folders]);
    // Also retry notification after a restart or partial write failure.
    await refreshLibrary().catch(error=>console.warn(JSON.stringify({event:'acquisition_library_refresh_deferred',error:String(error)})));
    stateSet(`acquisition_identity_done:${job.albumId}`,JSON.stringify({repaired,at:new Date().toISOString()}));
    db().prepare('DELETE FROM state WHERE key=?').run(saved.key);
    console.log(JSON.stringify({event:'acquisition_identity_recovered',albumId:job.albumId,repaired}));
  }catch(error){stateSet(saved.key,saved.value);console.warn(JSON.stringify({event:'acquisition_identity_recovery_deferred',error:String(error)}))}
}
