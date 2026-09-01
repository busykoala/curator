import { createHash } from "node:crypto";
import { db } from "@/features/db/client";
import { versions } from "@/config";
import type { CategorizationFile } from "./types";

function parse(value:string):Record<string,unknown>{try{return JSON.parse(value) as Record<string,unknown>}catch{return{}}}
function bounded(value:unknown,depth=0):unknown{
  if(typeof value==="string")return value.slice(0,600);if(typeof value==="number"||typeof value==="boolean"||value==null)return value;
  if(depth>2)return"[omitted]";if(Array.isArray(value))return value.slice(0,16).map(item=>bounded(item,depth+1));
  if(typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).slice(0,35).map(([key,item])=>[key,bounded(item,depth+1)]));return String(value).slice(0,300);
}

export function pendingAlbumKeys(limit:number):string[]{
  return(db().prepare(`SELECT f.album_key FROM files f LEFT JOIN track_profiles p ON p.file_id=f.id WHERE f.status IN ('analyzed','written') AND (p.file_id IS NULL OR p.album_key<>f.album_key OR p.schema_version<>? OR p.classifier_version<>? OR coalesce(json_extract(p.provenance_json,'$.audioAnalyzer'),0)<>? OR p.status='pending' OR (p.status IN ('partial','failed') AND coalesce(p.next_retry_at,CURRENT_TIMESTAMP)<=CURRENT_TIMESTAMP) OR f.updated_at>p.source_updated_at) GROUP BY f.album_key ORDER BY min(CASE WHEN p.status IN ('partial','failed') AND coalesce(p.next_retry_at,CURRENT_TIMESTAMP)<=CURRENT_TIMESTAMP THEN 0 WHEN p.file_id IS NULL THEN 1 ELSE 2 END),min(f.updated_at),f.album_key LIMIT ?`).all(versions.categorizationSchema,versions.categorizationPrompt,versions.audioAnalysis,limit) as Array<{album_key:string}>).map(row=>row.album_key);
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

export function sourceFingerprint(file:CategorizationFile,evidence:Record<string,unknown>):string{
  const relevant={artist:file.artist,album:file.album,tags:bounded(file.tags),evidence:bounded(evidence)};
  return createHash("sha256").update(JSON.stringify(relevant)).digest("hex");
}
