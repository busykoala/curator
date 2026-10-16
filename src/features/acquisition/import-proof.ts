import {basename,extname} from 'node:path';
import {allowedQuality,decodeTitle} from './matching';

export type ImportRow = Record<string,unknown> & {path:string;audioTags?:{title?:string;artistTitle?:string;duration?:string;trackNumbers?:number[];discNumber?:number}};
export type ReleaseTrack = {id:number;albumId:number;artistId:number;title:string;duration:number;absoluteTrackNumber:number;mediumNumber:number;foreignRecordingId?:string;hasFile?:boolean;trackFileId?:number};
export type ImportProof = {releaseId:number;files:Array<{row:ImportRow;track:ReleaseTrack}>;excludedImages:string[];durationError:number};
const key=(s:string)=>decodeTitle(s).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/\bthree\b/g,'3').replace(/[^\p{L}\p{N}]/gu,'');
export function durationMs(value?:string){
  const m=/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value??'');
  return m?(Number(m[1])*3600+Number(m[2])*60+Number(m[3]))*1000:0;
}
function titles(row:ImportRow,artist:string){
  const name=basename(row.path,extname(row.path)).replace(/^\d+[.\s_-]+/,'');
  const prefix=key(artist);
  return [row.audioTags?.title,name].filter((s):s is string=>Boolean(s)).map(key).flatMap(s=>[s,...(s.startsWith(prefix)?[s.slice(prefix.length)]:[])]);
}
function titleMatches(names:string[],track:string){
  const expected=key(track);
  return names.some(n=>n===expected||(
    // A few filenames truncate the very end of a long title. Track position,
    // duration and every other track must independently agree as well.
    n.length>=24&&n.length/expected.length>=.95&&expected.startsWith(n)
  ));
}
/** Full release proof; no partial track lists, fuzzy artist aliases or recording substitutions. */
export function proveRelease(rows:ImportRow[],tracks:ReleaseTrack[],releaseId:number,albumId:number,artistId:number,artist:string):ImportProof|undefined{
  if(tracks.length<3||tracks.some(t=>t.albumId!==albumId||t.artistId!==artistId||t.hasFile||t.trackFileId||t.duration<=0)||new Set(tracks.map(t=>t.id)).size!==tracks.length)return;
  const total=tracks.reduce((n,t)=>n+t.duration,0);
  const images=rows.filter(r=>durationMs(r.audioTags?.duration)>total*.95&&rows.length===tracks.length+1);
  const files=rows.filter(r=>!images.includes(r));
  // A CUE image is redundant only when its duration equals all split tracks.
  if(images.length>1||files.length!==tracks.length||images.some(r=>Math.abs(durationMs(r.audioTags?.duration)-files.reduce((n,f)=>n+durationMs(f.audioTags?.duration),0))>2000))return;
  if(new Set(files.map(r=>r.path)).size!==files.length)return;
  const used=new Set<number>();let durationError=0;
  const mapped:ImportProof['files']=[];
  for(const row of files){
    if(!row.path.startsWith('/data/downloads/')||row.path.split('/').includes('..')||!/\.(flac|mp3)$/i.test(row.path))return;
    if(!allowedQuality(row,true))return;
    if(row.audioTags?.artistTitle&&key(row.audioTags.artistTitle)!==key(artist))return;
    const duration=durationMs(row.audioTags?.duration),names=titles(row,artist);
    if(!duration)return;
    const position=row.audioTags?.trackNumbers?.find(n=>n>0)??Number(/^([0-9]+)[.\s_-]/.exec(basename(row.path))?.[1]??0);
    const candidates=tracks.filter(t=>!used.has(t.id)&&titleMatches(names,t.title)&&Math.abs(t.duration-duration)<=Math.max(2500,Math.min(5000,t.duration*.02))&&(!position||position===t.absoluteTrackNumber));
    if(candidates.length!==1)return;
    const track=candidates[0];used.add(track.id);durationError+=Math.abs(track.duration-duration);mapped.push({row,track});
  }
  return{releaseId,files:mapped,excludedImages:images.map(r=>r.path),durationError};
}
export function acceptsProvenImport(rows:Record<string,unknown>[],proof:ImportProof,albumId:number,artistId:number){
  if(rows.length!==proof.files.length)return false;
  return proof.files.every(({row,track})=>{
    const fresh=rows.find(r=>r.path===row.path),tracks=fresh?.tracks as {id:number}[]|undefined;
    return fresh&&(fresh.album as {id?:number})?.id===albumId&&(fresh.artist as {id?:number})?.id===artistId&&Number(fresh.albumReleaseId)===proof.releaseId&&tracks?.length===1&&tracks[0].id===track.id&&Array.isArray(fresh.rejections)&&fresh.rejections.every(r=>/^Album match is not close enough:/.test(String((r as {reason?:string}).reason)));
  });
}
