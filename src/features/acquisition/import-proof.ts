import {basename,dirname,extname} from 'node:path';
import {allowedQuality,decodeTitle} from './matching';

export type ImportRow = Record<string,unknown> & {path:string;audioTags?:{title?:string;artistTitle?:string;duration?:string;trackNumbers?:number[];discNumber?:number}};
export type ReleaseTrack = {id:number;albumId:number;artistId:number;title:string;duration:number;absoluteTrackNumber:number;mediumNumber:number;foreignRecordingId?:string;foreignTrackId?:string;titleAliases?:string[];hasFile?:boolean;trackFileId?:number};
export type ImportProof = {releaseId:number;files:Array<{row:ImportRow;track:ReleaseTrack}>;excludedImages:string[];durationError:number};
const key=(s:string)=>decodeTitle(s).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/\bthree\b/g,'3').replace(/[^\p{L}\p{N}]/gu,'');
export function durationMs(value?:string){
  const m=/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value??'');
  return m?(Number(m[1])*3600+Number(m[2])*60+Number(m[3]))*1000:0;
}
function withoutMastering(value:string){
  return value.replace(/\(([^)]*)\)/g,(whole,inside:string)=>/^(?:(?:\d{4}|24[- ]?bit)\s+)?(?:(?:rudy van gelder|digital(?:ly)?|24[- ]?bit)\s+)*(?:remaster(?:ed)?|mastering|edition)(?:\s+(?:\d{2}|\d{4}))?(?:\s+version)?$/i.test(inside.trim())||/^rudy van gelder$/i.test(inside.trim())?'':whole);
}
function withoutScoreCredit(value:string,albumTitle?:string){
  if(!albumTitle)return value;
  return value.replace(/\s*\(from\s+["“](.+?)["”]\s+score\)\s*$/i,(whole,credit:string)=>{
    const root=albumTitle.replace(/[:\s]*(?:\(?original motion picture score\)?)\s*$/i,'');
    return key(credit)===key(root)?'':whole;
  });
}
function titles(row:ImportRow,artist:string,albumTitle?:string){
  const name=basename(row.path,extname(row.path)).replace(/^\d+[.\s_-]+/,'');
  const prefix=key(artist);
  return [row.audioTags?.title,name].filter((s):s is string=>Boolean(s)).map(s=>key(withoutMastering(withoutScoreCredit(s,albumTitle)))).flatMap(s=>[s,...(s.startsWith(prefix)?[s.slice(prefix.length)]:[])]);
}
function variants(value:string){return [...new Set(value.toLowerCase().match(/\b(?:live|remix(?:ed)?|instrumental|karaoke|reprise|alternate|version|take|demo|edit|acoustic)\b/g)??[])].sort().join(',')}
function oneTypo(a:string,b:string){
  if(Math.min(a.length,b.length)<7||a[0]!==b[0]||Math.abs(a.length-b.length)>1)return false;
  let i=0,j=0,errors=0;
  while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue}if(++errors>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++}
  return errors+(i<a.length||j<b.length?1:0)<=1;
}
function titleMatch(names:string[],track:ReleaseTrack,row:ImportRow,allowTypo:boolean){
  const expected=key(withoutMastering(track.title)),source=row.audioTags?.title??basename(row.path,extname(row.path));
  const sameVariant=variants(withoutMastering(source))===variants(withoutMastering(track.title));
  const labels=[expected,...(sameVariant?track.titleAliases??[]:[]).map(s=>key(withoutMastering(s)))];
  if(names.some(n=>labels.includes(n)||(sameVariant&&n.length>=24&&n.length/expected.length>=.95&&expected.startsWith(n))))return 0;
  return allowTypo&&sameVariant&&names.some(n=>labels.some(label=>oneTypo(n,label)))?1:-1;
}
function discNumber(row:ImportRow){
  const tag=row.audioTags?.discNumber??0,folder=Number(/\b(?:disc|disk|cd)\s*0*(\d+)\b/i.exec(basename(dirname(row.path)))?.[1]??0);
  return tag&&folder&&tag!==folder?-1:tag||folder;
}
/** Full release proof; no partial track lists, fuzzy artist aliases or recording substitutions. */
export function proveRelease(rows:ImportRow[],tracks:ReleaseTrack[],releaseId:number,albumId:number,artistId:number,artist:string,onMissingTitle?:(track:ReleaseTrack)=>void,albumTitle?:string):ImportProof|undefined{
  if(tracks.length<3||tracks.some(t=>t.albumId!==albumId||t.artistId!==artistId||t.hasFile||t.trackFileId||t.duration<=0)||new Set(tracks.map(t=>t.id)).size!==tracks.length)return;
  const total=tracks.reduce((n,t)=>n+t.duration,0);
  const images=rows.filter(r=>durationMs(r.audioTags?.duration)>total*.95&&rows.length===tracks.length+1);
  const files=rows.filter(r=>!images.includes(r));
  // A CUE image is redundant only when its duration equals all split tracks.
  if(images.length>1||files.length!==tracks.length||images.some(r=>Math.abs(durationMs(r.audioTags?.duration)-files.reduce((n,f)=>n+durationMs(f.audioTags?.duration),0))>2000))return;
  if(new Set(files.map(r=>r.path)).size!==files.length)return;
  const used=new Set<number>();let durationError=0,typos=0;
  const multiDisc=new Set(tracks.map(t=>t.mediumNumber)).size>1;
  const mapped:ImportProof['files']=[];
  for(const row of files){
    if(!row.path.startsWith('/data/downloads/')||row.path.split('/').includes('..')||!/\.(flac|mp3)$/i.test(row.path))return;
    if(!allowedQuality(row,true))return;
    if(row.audioTags?.artistTitle&&key(row.audioTags.artistTitle)!==key(artist))return;
    const duration=durationMs(row.audioTags?.duration),names=titles(row,artist,albumTitle);
    if(!duration)return;
    const position=row.audioTags?.trackNumbers?.find(n=>n>0)??Number(/^([0-9]+)[.\s_-]/.exec(basename(row.path))?.[1]??0);
    const disc=discNumber(row);
    if(disc<0||(multiDisc&&!disc))return;
    const positioned=tracks.filter(t=>!used.has(t.id)&&(!disc||t.mediumNumber===disc)&&Math.abs(t.duration-duration)<=Math.max(2500,Math.min(5000,t.duration*.02))&&(!position||position===t.absoluteTrackNumber));
    const candidates=positioned.filter(t=>titleMatch(names,t,row,files.length>=10&&position>0)>=0);
    if(candidates.length!==1){if(positioned.length===1&&position>0)onMissingTitle?.(positioned[0]);return}
    const match=titleMatch(names,candidates[0],row,files.length>=10&&position>0);
    if(match===1&&++typos>Math.floor(files.length*.1))return;
    const track=candidates[0];used.add(track.id);durationError+=Math.abs(track.duration-duration);mapped.push({row,track});
  }
  return{releaseId,files:mapped,excludedImages:images.map(r=>r.path),durationError};
}
export function acceptsProvenImport(rows:Record<string,unknown>[],proof:ImportProof,albumId:number,artistId:number){
  if(rows.length!==proof.files.length)return false;
  return proof.files.every(({row,track})=>{
    const fresh=rows.find(r=>r.path===row.path),tracks=fresh?.tracks as {id:number}[]|undefined;
    return fresh&&(fresh.album as {id?:number})?.id===albumId&&(fresh.artist as {id?:number})?.id===artistId&&Number(fresh.albumReleaseId)===proof.releaseId&&tracks?.length===1&&tracks[0].id===track.id&&Array.isArray(fresh.rejections)&&fresh.rejections.every(r=>{
      const reason=String((r as {reason?:string}).reason);
      return /^Album match is not close enough:/.test(reason)||/^Worst track match: [\d.]+ % vs [\d.]+ % \[track title\]$/.test(reason);
    });
  });
}
