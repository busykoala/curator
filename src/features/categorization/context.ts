import { createHash } from "node:crypto";
import { db } from "@/features/db/client";
import { versions } from "@/config";
import type { CategorizationFile } from "./types";
import { withoutCuratorTags } from "./curator-tags";

function parse(value:string):Record<string,unknown>{try{return JSON.parse(value) as Record<string,unknown>}catch{return{}}}
function bounded(value:unknown,depth=0):unknown{
  if(typeof value==="string")return value.slice(0,600);if(typeof value==="number"||typeof value==="boolean"||value==null)return value;
  if(depth>2)return"[omitted]";if(Array.isArray(value))return value.slice(0,16).map(item=>bounded(item,depth+1));
  if(typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).slice(0,35).map(([key,item])=>[key,bounded(item,depth+1)]));return String(value).slice(0,300);
}

export function pendingAlbumKeys(limit:number):string[]{
  return(db().prepare(`SELECT f.album_key FROM files f LEFT JOIN track_profiles p ON p.file_id=f.id WHERE f.status IN ('analyzed','written') AND (p.file_id IS NULL OR p.album_key<>f.album_key OR p.schema_version<>? OR p.classifier_version<>? OR coalesce(json_extract(p.provenance_json,'$.audioAnalyzer'),0)<>? OR p.status='pending' OR (p.status IN ('partial','failed') AND coalesce(p.next_retry_at,CURRENT_TIMESTAMP)<=CURRENT_TIMESTAMP) OR f.updated_at>p.source_updated_at) GROUP BY f.album_key ORDER BY min(CASE WHEN p.status IN ('partial','failed') AND coalesce(p.next_retry_at,CURRENT_TIMESTAMP)<=CURRENT_TIMESTAMP THEN 0 WHEN p.file_id IS NULL THEN 1 ELSE 2 END),min(f.updated_at),f.album_key LIMIT ?`).all(versions.categorizationSchema,versions.categorizationPrompt,versions.audioAnalysis,limit) as Array<{album_key:string}>).map(row=>row.album_key);
}

export function albumNeedsCategorization(albumKey:string):boolean{
  return Boolean(db().prepare(`SELECT 1 FROM files f LEFT JOIN track_profiles p ON p.file_id=f.id WHERE f.album_key=? AND f.status IN ('analyzed','written') AND (p.file_id IS NULL OR p.album_key<>f.album_key OR p.schema_version<>? OR p.classifier_version<>? OR coalesce(json_extract(p.provenance_json,'$.audioAnalyzer'),0)<>? OR p.status='pending' OR (p.status IN ('partial','failed') AND coalesce(p.next_retry_at,CURRENT_TIMESTAMP)<=CURRENT_TIMESTAMP) OR f.updated_at>p.source_updated_at) LIMIT 1`).get(albumKey,versions.categorizationSchema,versions.categorizationPrompt,versions.audioAnalysis));
}

export function categorizationPendingCount():number{
  return(db().prepare(`SELECT count(*) count FROM files f LEFT JOIN track_profiles p ON p.file_id=f.id WHERE f.status IN ('analyzed','written') AND (p.file_id IS NULL OR p.album_key<>f.album_key OR p.schema_version<>? OR p.classifier_version<>? OR coalesce(json_extract(p.provenance_json,'$.audioAnalyzer'),0)<>? OR p.status='pending' OR (p.status IN ('partial','failed') AND coalesce(p.next_retry_at,CURRENT_TIMESTAMP)<=CURRENT_TIMESTAMP) OR f.updated_at>p.source_updated_at)`).get(versions.categorizationSchema,versions.categorizationPrompt,versions.audioAnalysis) as{count:number}).count;
}

export function loadAlbumFiles(albumKey:string):CategorizationFile[]{
  return(db().prepare("SELECT id,path,album_key,artist_name,album_name,format,inode,size,mtime_ms,tags_json,updated_at FROM files WHERE album_key=? AND status IN ('analyzed','written') ORDER BY path").all(albumKey) as Array<Record<string,unknown>>).map(row=>({id:Number(row.id),path:String(row.path),albumKey:String(row.album_key),artist:String(row.artist_name),album:String(row.album_name),format:String(row.format),inode:Number(row.inode),size:Number(row.size),mtimeMs:Number(row.mtime_ms),sourceUpdatedAt:String(row.updated_at),tags:parse(String(row.tags_json))}));
}

export function albumEvidence(albumKey:string):Record<string,unknown>{
  const enrichment=db().prepare("SELECT result_json,model,created_at FROM enrichments WHERE entity_key=? ORDER BY id DESC LIMIT 1").get(albumKey) as{result_json:string;model:string;created_at:string}|undefined;
  const sources=db().prepare("SELECT provider,source_id,payload_json,fetched_at FROM evidence WHERE entity_key=? ORDER BY fetched_at DESC LIMIT 8").all(albumKey) as Array<{provider:string;source_id:string;payload_json:string;fetched_at:string}>;
  return{albumEnrichment:enrichment?{model:enrichment.model,createdAt:enrichment.created_at,value:bounded(parse(enrichment.result_json))}:null,sources:sources.map(source=>({provider:source.provider,sourceId:source.source_id,fetchedAt:source.fetched_at,value:bounded(parse(source.payload_json))}))};
}

function stableEvidence(value:unknown):unknown{
  if(Array.isArray(value))return value.map(stableEvidence).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).filter(([key])=>key!=="createdAt"&&key!=="fetchedAt").sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stableEvidence(item)]));
  return value;
}

/** Pre-v2 fingerprint; it included Curator's own written tags. Kept only to migrate stored values. */
export function legacySourceFingerprint(file:CategorizationFile,evidence:Record<string,unknown>):string{
  const relevant={artist:file.artist,album:file.album,tags:bounded(file.tags),evidence:stableEvidence(bounded(evidence))};
  return createHash("sha256").update(JSON.stringify(relevant)).digest("hex");
}
/** Source evidence for classification, excluding tags Curator writes itself (so tag rewrites are not "changes"). */
export function sourceFingerprint(file:CategorizationFile,evidence:Record<string,unknown>):string{
  const relevant={artist:file.artist,album:file.album,tags:bounded(withoutCuratorTags(file.tags)),evidence:stableEvidence(bounded(evidence))};
  return "v2:"+createHash("sha256").update(JSON.stringify(relevant)).digest("hex");
}
/**
 * Move stored fingerprints to v2. The legacy value hashed tags Curator wrote after
 * classifying, so a mismatch usually means "Curator wrote tags", not "the source
 * changed"; artist/album and audio changes are caught by the album-key and audio
 * fingerprint checks. Mismatches are counted for visibility only.
 * Must finish before any library-wide tag rewrite, or every album would be reclassified.
 * Returns the number of albums still to check.
 */
export function upgradeSourceFingerprints(albumLimit=200):number{
  const pending=db().prepare("SELECT DISTINCT album_key FROM track_profiles WHERE source_fingerprint NOT LIKE 'v2:%' LIMIT ?").all(albumLimit) as Array<{album_key:string}>;
  const update=db().prepare("UPDATE track_profiles SET source_fingerprint=? WHERE file_id=? AND source_fingerprint=?");
  const stale=db().prepare("UPDATE track_profiles SET source_fingerprint='v2:stale' WHERE file_id=? AND source_fingerprint=?");
  let legacyMismatches=Number(db().prepare("SELECT value FROM state WHERE key='source_fingerprint_v2_mismatches'").pluck().get()??0);
  for(const {album_key} of pending){
    const evidence=albumEvidence(album_key),files=new Map(loadAlbumFiles(album_key).map(file=>[file.id,file]));
    const rows=db().prepare("SELECT file_id,source_fingerprint FROM track_profiles WHERE album_key=? AND source_fingerprint NOT LIKE 'v2:%'").all(album_key) as Array<{file_id:number;source_fingerprint:string}>;
    db().transaction(()=>{for(const row of rows){
      const file=files.get(row.file_id);
      if(!file){stale.run(row.file_id,row.source_fingerprint);continue} // not loadable now: classify when it returns
      if(legacySourceFingerprint(file,evidence)!==row.source_fingerprint)legacyMismatches++;
      update.run(sourceFingerprint(file,evidence),row.file_id,row.source_fingerprint);
    }})();
  }
  db().prepare("INSERT INTO state(key,value) VALUES ('source_fingerprint_v2_mismatches',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(legacyMismatches));
  return(db().prepare("SELECT count(DISTINCT album_key) n FROM track_profiles WHERE source_fingerprint NOT LIKE 'v2:%'").get() as{n:number}).n;
}
