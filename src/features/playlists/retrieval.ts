import {createHash} from 'node:crypto';
import {config} from '@/config';
import {db,stateGet,stateSet} from '@/features/db/client';
import {recordAiUsage} from '@/features/ai/usage';
import {playlistTrackEvidence} from './evidence-repository';
import type {PlaylistCandidate} from './types';
import {trackEvidenceVersion,type TrackEvidenceView} from './track-evidence';
import type {EvidencedCandidate} from './selection-policy';

const dimensions=1024,descriptionVersion=1;
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export type RetrievalProvider={
  embed:(texts:string[],signal?:AbortSignal)=>Promise<number[][]>;
  rerank:(query:string,texts:string[],signal?:AbortSignal)=>Promise<Array<{index:number;score:number}>>;
};
type CachedVector={file_id:number;content_hash:string;vector:Buffer;dimensions:number};
export function canonicalTrackDescription(track:Pick<PlaylistCandidate,'artist'|'title'|'album'>,evidence:TrackEvidenceView){
  const fields=['genre','style','mood','listeningContexts','instrumentation','vocalProfile','energy','valence','texture','groove','production','recordingTypes','acousticElectronicCharacter'];
  const text=fields.flatMap(key=>{
    const field=evidence.fields[key];if(field?.value==null||['conflict','unknown'].includes(field.source))return[];
    const values=Array.isArray(field.value)?field.value.map(String).sort().join(', '):String(field.value);
    return[`${key}: ${values} (${field.confidence} confidence)`];
  });
  // Shared documents contain musical evidence only, never a user's plays,
  // favourites, conversation, credentials, feedback or exposure history.
  return[`${track.artist} — ${track.title}`,`album: ${track.album}`,...text,evidence.originalYear?`original year: ${evidence.originalYear}`:''].filter(Boolean).join('\n').slice(0,1100);
}
export const descriptionHash=(description:string)=>hash(`playlist-description:${descriptionVersion}\n${description}`);
export function rerankingDescription(track:EvidencedCandidate){
  const fields=['genre','style','mood','listeningContexts','instrumentation','vocalProfile','energy','acousticElectronicCharacter'];
  return[track.artist+' — '+track.title,...fields.flatMap(key=>{
    const field=track.evidence.fields[key];if(field?.value==null||['unknown','conflict'].includes(field.source))return[];
    return[key+': '+(Array.isArray(field.value)?field.value.slice(0,6).join(', '):String(field.value))];
  })].join('\n').slice(0,600);
}
function vector(values:number[]){
  if(values.length!==dimensions||values.some(value=>!Number.isFinite(value))||!values.some(value=>value!==0))throw Error('Retrieval service returned an invalid embedding');
  const result=Float32Array.from(values);if(result.some(value=>!Number.isFinite(value)))throw Error('Embedding exceeds the supported numeric range');return result;
}
const encode=(values:number[])=>Buffer.from(vector(values).buffer);
function decode(bytes:Buffer,size:number){
  if(size!==dimensions||bytes.byteLength!==size*4)throw Error('Cached embedding dimensions are invalid');
  const copy=Uint8Array.from(bytes);return new Float32Array(copy.buffer);
}
export function cosine(left:Float32Array,right:Float32Array){
  if(left.length!==right.length)return-Infinity;
  let product=0,l=0,r=0;for(let i=0;i<left.length;i++){product+=left[i]*right[i];l+=left[i]*left[i];r+=right[i]*right[i]}
  return l&&r?product/Math.sqrt(l*r):-Infinity;
}
async function retrievalRequest<T>(kind:'embedding'|'reranker',path:string,body:unknown,signal?:AbortSignal):Promise<T>{
  const key=`playlist_retrieval_cooldown:${kind}`;
  if(Number(stateGet(key,'0'))>Date.now())throw Error(`${kind} is cooling down`);
  const deadline=AbortSignal.timeout(12_000),combined=signal?AbortSignal.any([signal,deadline]):deadline;
  const response=await fetch(config.CURATOR_AI_BASE_URL.replace(/\/+$/,'')+path,{method:'POST',headers:{Authorization:'Bearer '+config.CURATOR_AI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),signal:combined});
  if(!response.ok){
    const raw=response.headers.get('retry-after'),seconds=Number(raw),wait=raw?(Number.isFinite(seconds)?seconds*1000:Date.parse(raw)-Date.now()):60_000;
    if(response.status===429||response.status>=500)stateSet(key,String(Date.now()+Math.max(1000,Number.isFinite(wait)?wait:60_000)));
    // Do not place proxy error bodies, headers or credentials in reports.
    throw Error(`${kind} request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}
export const localRetrievalProvider:RetrievalProvider={
  async embed(texts,signal){
    const result=await retrievalRequest<{data:Array<{index:number;embedding:number[]}>;usage?:{prompt_tokens:number;total_tokens:number}}>('embedding','/embeddings',{model:'embedding',input:texts,encoding_format:'float'},signal);
    if(!Array.isArray(result.data)||result.data.length!==texts.length||new Set(result.data.map(row=>row.index)).size!==texts.length)throw Error('Incomplete embedding batch');
    const ordered=[...result.data].sort((a,b)=>a.index-b.index);
    if(ordered.some((row,index)=>row.index!==index))throw Error('Invalid embedding indexes');
    for(const row of ordered)vector(row.embedding);
    recordAiUsage('playlist_embeddings',config.CURATOR_EMBEDDING_VERSION,{usage:result.usage?{input_tokens:result.usage.prompt_tokens,total_tokens:result.usage.total_tokens}:undefined});
    return ordered.map(row=>row.embedding);
  },
  async rerank(query,texts,signal){
    const results:Array<{index:number;score:number}>=[];
    // TEI's token/client batch limits apply to the existing deployment. Small
    // batches avoid a single 120-document request exhausting that capacity.
    for(let offset=0;offset<texts.length;offset+=8){
      const batch=texts.slice(offset,offset+8),ranked=await retrievalRequest<Array<{index:number;score:number}>>('reranker','/rerank',{query:query.slice(0,800),texts:batch,truncate:true,raw_scores:true,return_text:false},signal);
      if(!Array.isArray(ranked)||ranked.length!==batch.length||new Set(ranked.map(row=>row.index)).size!==batch.length||ranked.some(row=>!Number.isInteger(row.index)||row.index<0||row.index>=batch.length||!Number.isFinite(row.score)))throw Error('Malformed reranking result');
      results.push(...ranked.map(row=>({...row,index:offset+row.index})));
    }
    return results.sort((a,b)=>b.score-a.score);
  },
};

export function storeTrackEmbeddings(tracks:Array<{fileId:number;description:string}>,embeddings:number[][],modelVersion=config.CURATOR_EMBEDDING_VERSION,now=Date.now()){
  if(tracks.length!==embeddings.length)throw Error('Embedding batch does not match its documents');
  const encoded=embeddings.map(encode);
  db().transaction(()=>{
    const insert=db().prepare(`INSERT INTO playlist_track_embeddings(file_id,model_version,content_hash,vector,dimensions,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(file_id,model_version) DO UPDATE SET content_hash=excluded.content_hash,vector=excluded.vector,dimensions=excluded.dimensions,updated_at=excluded.updated_at`);
    tracks.forEach((track,index)=>insert.run(track.fileId,modelVersion,descriptionHash(track.description),encoded[index],dimensions,now));
  })();
}
async function queryEmbedding(query:string,provider:RetrievalProvider,signal?:AbortSignal){
  const input='Instruct: Given a musical direction, retrieve recordings whose musical evidence fits the requested style, mood and listening context.\nQuery: '+query.slice(0,2000),contentHash=hash(input);
  const cached=db().prepare('SELECT vector,dimensions FROM playlist_query_embeddings WHERE content_hash=? AND model_version=?').get(contentHash,config.CURATOR_EMBEDDING_VERSION) as {vector:Buffer;dimensions:number}|undefined;
  if(cached)return decode(cached.vector,cached.dimensions);
  const [embedding]=await provider.embed([input],signal),encoded=encode(embedding);
  db().prepare('INSERT OR REPLACE INTO playlist_query_embeddings(content_hash,model_version,vector,dimensions,updated_at) VALUES(?,?,?,?,?)').run(contentHash,config.CURATOR_EMBEDDING_VERSION,encoded,dimensions,Date.now());
  db().prepare('DELETE FROM playlist_query_embeddings WHERE rowid NOT IN (SELECT rowid FROM playlist_query_embeddings ORDER BY updated_at DESC LIMIT 500)').run();
  return vector(embedding);
}

export function mergeHybridRanks(lexical:number[],semantic:number[],mandatoryIds:number[]=[],limit=120){
  const scores=new Map<number,number>();
  for(const ranked of [lexical,semantic])ranked.slice(0,120).forEach((id,index)=>scores.set(id,(scores.get(id)??0)+1/(60+index+1)));
  const allowed=new Set([...lexical,...semantic]);
  const mandatory=[...new Set(mandatoryIds)].filter(id=>allowed.has(id)).slice(0,Math.min(120,limit)),included=new Set(mandatory);
  return[...mandatory,...[...scores].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).map(([id])=>id).filter(id=>!included.has(id))].slice(0,Math.min(120,limit));
}
export async function retrievePlaylistCandidates(query:string,pool:EvidencedCandidate[],options:{provider?:RetrievalProvider;signal?:AbortSignal;mandatoryIds?:number[]}={}){
  const started=Date.now(),provider=options.provider??localRetrievalProvider,lexical=[...pool].sort((a,b)=>b.score-a.score||a.fileId-b.fileId),byId=new Map(pool.map(track=>[track.fileId,track]));
  const descriptions=new Map(pool.map(track=>[track.fileId,canonicalTrackDescription(track,track.evidence)]));
  let semantic:number[]=[],coverage=0,embeddingError='',rerankingError='';
  try{
    const queryVector=await queryEmbedding(query,provider,options.signal);
    const cached=db().prepare('SELECT file_id,content_hash,vector,dimensions FROM playlist_track_embeddings WHERE model_version=?').all(config.CURATOR_EMBEDDING_VERSION) as CachedVector[];
    const matched=cached.filter(row=>byId.has(row.file_id)&&row.content_hash===descriptionHash(descriptions.get(row.file_id)!));coverage=matched.length;
    semantic=matched.map(row=>({id:row.file_id,score:cosine(queryVector,decode(row.vector,row.dimensions))})).sort((a,b)=>b.score-a.score).map(row=>row.id);
  }catch(error){options.signal?.throwIfAborted();embeddingError=String(error).slice(0,200)}
  const merged=mergeHybridRanks(lexical.map(track=>track.fileId),semantic,options.mandatoryIds),retrieved=merged.map(id=>byId.get(id)!);
  let candidates=retrieved;
  try{
    const ranked=await provider.rerank(query,retrieved.map(rerankingDescription),options.signal);
    if(ranked.length!==retrieved.length||new Set(ranked.map(row=>row.index)).size!==retrieved.length||ranked.some(row=>!retrieved[row.index]||!Number.isFinite(row.score)))throw Error('Incomplete reranking result');
    // Sorting by the returned scores makes batch ordering explicit. The model
    // cannot change eligibility, identities, or the deterministic hard rules.
    candidates=[...ranked].sort((a,b)=>b.score-a.score).map(row=>retrieved[row.index]);
  }catch(error){options.signal?.throwIfAborted();rerankingError=String(error).slice(0,200);candidates=lexical.filter(track=>merged.includes(track.fileId))}
  return{candidates:candidates.slice(0,120),detail:{embeddingModel:config.CURATOR_EMBEDDING_VERSION,rerankerModel:config.CURATOR_RERANKER_VERSION,eligible:pool.length,embeddingCoverage:coverage,retrieved:retrieved.length,embeddingError,rerankingError,latencyMs:Date.now()-started}};
}

const embeddingSources=`FROM files f JOIN track_profiles p ON p.file_id=f.id
    LEFT JOIN track_profile_overrides o ON o.file_id=f.id LEFT JOIN playlist_metadata_reviews r ON r.file_id=f.id
    LEFT JOIN playlist_track_evidence v ON v.file_id=f.id
    LEFT JOIN playlist_track_embeddings e ON e.file_id=f.id AND e.model_version=?`;
const embeddingDue=`WHERE f.status='written' AND p.status='complete' AND (e.file_id IS NULL OR coalesce(v.version,0)<>? OR e.updated_at<
      max(coalesce(unixepoch(p.updated_at)*1000+999,0),coalesce(unixepoch(f.updated_at)*1000+999,0),coalesce(unixepoch(o.updated_at)*1000+999,0),coalesce(unixepoch(v.updated_at)*1000+999,0),coalesce(r.updated_at,0)))`;
export function playlistEmbeddingBacklog(){
  return(db().prepare(`SELECT count(*) n ${embeddingSources} ${embeddingDue}`).get(config.CURATOR_EMBEDDING_VERSION,trackEvidenceVersion) as {n:number}).n;
}
export function revalidateUnchangedPlaylistEmbeddings(limit=512){
  const rows=db().prepare(`SELECT f.id,f.artist_name,f.album_name,f.tags_json,e.content_hash ${embeddingSources} ${embeddingDue}
    AND e.file_id IS NOT NULL ORDER BY f.id LIMIT ?`).all(config.CURATOR_EMBEDDING_VERSION,trackEvidenceVersion,Math.max(0,Math.min(2048,limit))) as Array<{id:number;artist_name:string;album_name:string;tags_json:string;content_hash:string}>;
  let unchanged=0,changed=0;
  for(const row of rows){
    const evidence=playlistTrackEvidence(row.id);if(!evidence)continue;
    const tags=JSON.parse(row.tags_json),title=String(Array.isArray(tags.title)?tags.title[0]:tags.title??'');
    if(descriptionHash(canonicalTrackDescription({artist:row.artist_name,album:row.album_name,title},evidence))!==row.content_hash){changed++;continue}
    db().prepare('UPDATE playlist_track_embeddings SET updated_at=? WHERE file_id=? AND model_version=? AND content_hash=?').run(Date.now(),row.id,config.CURATOR_EMBEDDING_VERSION,row.content_hash);unchanged++;
  }
  return{checked:rows.length,unchanged,changed};
}
export async function preparePlaylistEmbeddings(limit=128,provider=localRetrievalProvider){
  if(stateGet('paused')==='true')return 0;
  const rows=db().prepare(`SELECT f.id,f.artist_name,f.album_name,f.tags_json,e.content_hash ${embeddingSources} ${embeddingDue}
    ORDER BY e.file_id IS NOT NULL,f.id LIMIT ?`).all(config.CURATOR_EMBEDDING_VERSION,trackEvidenceVersion,Math.max(0,Math.min(128,limit))) as Array<{id:number;artist_name:string;album_name:string;tags_json:string;content_hash:string|null}>;
  let completed=0;
  // The deployed four-thread, single-slot embedding server processes texts
  // sequentially. Eight descriptions fit its 12-second request deadline;
  // a 32-document batch timed out before any vectors could be committed.
  for(let offset=0;offset<rows.length;offset+=8){
    if(db().prepare("SELECT 1 FROM playlist_chat_jobs WHERE status IN ('queued','running') LIMIT 1").get())break;
    const batch=rows.slice(offset,offset+8).flatMap(row=>{
      const evidence=playlistTrackEvidence(row.id);if(!evidence)return[];
      const tags=JSON.parse(row.tags_json),title=String(Array.isArray(tags.title)?tags.title[0]:tags.title??'');
      const description=canonicalTrackDescription({artist:row.artist_name,title,album:row.album_name},evidence);
      if(row.content_hash===descriptionHash(description)){
        db().prepare('UPDATE playlist_track_embeddings SET updated_at=? WHERE file_id=? AND model_version=?').run(Date.now(),row.id,config.CURATOR_EMBEDDING_VERSION);return[];
      }
      return[{fileId:row.id,description}];
    });
    if(!batch.length)continue;
    const embeddings=await provider.embed(batch.map(track=>track.description));storeTrackEmbeddings(batch,embeddings);completed+=batch.length;
  }
  return completed;
}
