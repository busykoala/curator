import { db,stateGet,stateSet } from "@/features/db/client";
import { versions } from "@/config";
import { analyzeAudio } from "./audio";
import { aggregateAlbum } from "./aggregate";
import { classifyTracks } from "./classify";
import { fallbackProfile } from "./fallback";
import { albumEvidence,categorizationPendingCount,loadAlbumFiles,pendingAlbumKeys,sourceFingerprint } from "./context";
import { normalizeProfile,profileIsSparse } from "./vocabulary";
import { semanticProfileSchema } from "./schema";
import { acquireAlbumLease,releaseAlbumLease } from "@/features/scheduler/album-lease";
import type { AudioFeatures,TrackClassificationInput,TrackSemanticProfile } from "./types";

type Report=(value:{subject:string;phase:string;currentFile?:string;processedCount:number;totalCount:number})=>void;
type Prepared=TrackClassificationInput&{audioFingerprint:string;audioError?:string};
const emptyAudio:AudioFeatures={analyzedSeconds:0,sampleRate:0,rmsDb:-120,peakDb:-120,dynamicRangeDb:0,zeroCrossingRate:0,highFrequencyRatio:0,estimatedBpm:null,tempoCandidates:[],beatRegularity:0,energy:.5,danceability:.5};

async function pool<T,R>(items:T[],limit:number,work:(item:T,index:number)=>Promise<R>):Promise<R[]>{const output=new Array<R>(items.length),queue=items.map((item,index)=>({item,index}));await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{for(let next=queue.shift();next;next=queue.shift())output[next.index]=await work(next.item,next.index)}));return output}
function chunks<T>(items:T[],size:number):T[][]{const output:T[][]=[];for(let i=0;i<items.length;i+=size)output.push(items.slice(i,i+size));return output}
function manual(fileId:number):Record<string,unknown>{const row=db().prepare("SELECT patch_json FROM track_profile_overrides WHERE file_id=?").get(fileId) as{patch_json:string}|undefined;try{return row?JSON.parse(row.patch_json) as Record<string,unknown>:{}}catch{return{}}}
function applyManual(profile:TrackSemanticProfile,patch:Record<string,unknown>):TrackSemanticProfile{const parsed=semanticProfileSchema.partial().safeParse(patch);return parsed.success?semanticProfileSchema.parse({...profile,...parsed.data}):profile}

async function prepare(albumKey:string):Promise<{tracks:Prepared[];evidence:Record<string,unknown>}>{
  const evidence=albumEvidence(albumKey),files=loadAlbumFiles(albumKey),tracks=await pool(files,4,async file=>{const source=sourceFingerprint(file,evidence);try{const audio=await analyzeAudio(file);return{file,audio:audio.features,audioFingerprint:audio.fingerprint,sourceFingerprint:source}}catch(error){return{file,audio:emptyAudio,audioFingerprint:`unavailable:${file.size}:${file.mtimeMs}`,sourceFingerprint:source,audioError:String(error)}}});return{tracks,evidence};
}

function unchanged(track:Prepared):boolean{const row=db().prepare("SELECT album_key,audio_fingerprint,source_fingerprint,schema_version,classifier_version,status,coalesce(json_extract(provenance_json,'$.audioAnalyzer'),0) audio_analyzer_version FROM track_profiles WHERE file_id=?").get(track.file.id) as{album_key:string;audio_fingerprint:string;source_fingerprint:string;schema_version:number;classifier_version:number;status:string;audio_analyzer_version:number}|undefined;if(!row)return false;if(row.album_key!==track.file.albumKey||row.audio_fingerprint!==track.audioFingerprint||row.source_fingerprint!==track.sourceFingerprint||row.schema_version!==versions.categorizationSchema||row.classifier_version!==versions.categorizationPrompt||row.audio_analyzer_version!==versions.audioAnalysis||row.status!=="complete")return false;db().prepare("UPDATE track_profiles SET source_updated_at=?,updated_at=CURRENT_TIMESTAMP WHERE file_id=?").run(track.file.sourceUpdatedAt,track.file.id);return true}
function persist(track:Prepared,profile:TrackSemanticProfile,model:string,status:"complete"|"partial",error?:string):void{
  const patch=manual(track.file.id),final=applyManual(profile,patch),finalStatus=status==="complete"||(Object.keys(patch).length>0&&!profileIsSparse(final))?"complete":"partial",finalError=finalStatus==="complete"?null:error??track.audioError??"Semantic profile is sparse and scheduled for retry",transient=/(connection|timeout|temporar|fetch failed|\b429\b|\b503\b)/i.test(finalError??""),next=finalStatus==="complete"?null:transient?"datetime('now','+20 minutes')":"datetime('now','+1 day')";
  db().prepare(`INSERT INTO track_profiles(file_id,album_key,audio_fingerprint,source_fingerprint,profile_json,manual_json,provenance_json,status,schema_version,classifier_version,source_updated_at,attempt_count,next_retry_at,last_error) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,${next??"NULL"},?) ON CONFLICT(file_id) DO UPDATE SET album_key=excluded.album_key,audio_fingerprint=excluded.audio_fingerprint,source_fingerprint=excluded.source_fingerprint,profile_json=excluded.profile_json,manual_json=excluded.manual_json,provenance_json=excluded.provenance_json,status=excluded.status,schema_version=excluded.schema_version,classifier_version=excluded.classifier_version,source_updated_at=excluded.source_updated_at,attempt_count=track_profiles.attempt_count+1,next_retry_at=excluded.next_retry_at,last_error=excluded.last_error,updated_at=CURRENT_TIMESTAMP`).run(track.file.id,track.file.albumKey,track.audioFingerprint,track.sourceFingerprint,JSON.stringify(final),JSON.stringify(patch),JSON.stringify({model,audioAnalyzer:versions.audioAnalysis}),finalStatus,versions.categorizationSchema,versions.categorizationPrompt,track.file.sourceUpdatedAt,finalError);
  db().prepare("UPDATE issues SET status='resolved',updated_at=CURRENT_TIMESTAMP WHERE file_id=? AND code IN ('categorization_partial','categorization_failed') AND status='open'").run(track.file.id);if(finalStatus!=="complete")db().prepare("INSERT INTO issues(file_id,album_key,code,severity,message) VALUES (?,?,?,?,?)").run(track.file.id,track.file.albumKey,"categorization_partial","warning",finalError);
}

export async function processCategorizationBatch(albumLimit:number,report:Report):Promise<{albums:number;tracks:number;classified:number;reused:number;partial:number;remaining:number}>{
  const keys=pendingAlbumKeys(albumLimit);let albums=0,tracks=0,classified=0,reused=0,partial=0;
  for(const key of keys){
    if(stateGet("paused")==="true")break;
    if(!acquireAlbumLease(key,"categorize"))continue;
    try{
      const prepared=await prepare(key),needed=prepared.tracks.filter(track=>!unchanged(track));tracks+=prepared.tracks.length;reused+=prepared.tracks.length-needed.length;
      report({subject:`${prepared.tracks[0]?.file.artist??"Unknown"} / ${prepared.tracks[0]?.file.album??"Unknown"}`,phase:"categorize",processedCount:albums,totalCount:keys.length});
      const decisions=new Map<number,{profile:TrackSemanticProfile;model:string}>(),errors=new Map<number,string>();
      for(const group of await pool(chunks(needed,6),2,async chunk=>{try{return await classifyTracks(chunk,prepared.evidence)}catch(error){const message=String(error).slice(0,500);for(const track of chunk)errors.set(track.file.id,message);return new Map<number,{profile:TrackSemanticProfile;model:string}>()}}))for(const[id,value]of group)decisions.set(id,value);
      for(const track of needed){const decision=decisions.get(track.file.id),profile=decision?.profile??fallbackProfile(track.file,track.audio),status=decision&&!profileIsSparse(profile)?"complete":"partial",failure=errors.get(track.file.id)??(decision?undefined:"AI classification unavailable or invalid");persist(track,profile,decision?.model??"deterministic-fallback",status,failure);classified+=decision?1:0;partial+=status==="partial"?1:0}
      aggregateAlbum(key);albums++;
    }finally{releaseAlbumLease(key,"categorize")}
  }
  const remaining=categorizationPendingCount();stateSet("categorization_progress",JSON.stringify({albums,tracks,classified,reused,partial,remaining,updatedAt:new Date().toISOString()}));return{albums,tracks,classified,reused,partial,remaining};
}

export{categorizationPendingCount};
