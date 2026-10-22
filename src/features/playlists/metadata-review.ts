import {createHash,randomUUID} from 'node:crypto';
import {db,stateGet,stateSet} from '@/features/db/client';
import {cachedJson,fetchJson} from '@/features/sources/cache';
import {withMusicBrainzRequestLimit} from '@/features/sources/musicbrainz';
import {identityName,trackArtistMatches} from '@/features/integrations/navidrome-identity';
import {canonicalSemanticValue} from '@/features/categorization/vocabulary';
import type {ExternalTrackFact} from './track-evidence';

type Recording={id:string;title:string;length?:number;aliases?:Array<{name:string}>;'first-release-date'?:string;'artist-credit'?:Array<{name?:string;artist:{id:string;name:string}}>;
  genres?:Array<{name:string}>;relations?:Array<{type:string;attributes?:string[];artist?:{name:string}}>};
export type ReviewIdentity={fileId:number;artist:string;title:string;tags:Record<string,unknown>;durationMs:number;recordingId?:string;releaseGroupId?:string};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const strings=(v:unknown):string[]=>Array.isArray(v)?v.map(String):v==null?[]:[String(v)];
export function reviewIdentity(row:{id:number;artist_name:string;tags_json:string;properties_json:string}):ReviewIdentity{
  const tags=JSON.parse(row.tags_json),properties=JSON.parse(row.properties_json),tag=(names:string[])=>Object.entries(tags).filter(([k])=>names.includes(k.toLowerCase().replace(/[^a-z]/g,''))).flatMap(([,v])=>strings(v)).find(v=>uuid.test(v));
  return{fileId:row.id,artist:row.artist_name,title:strings(tags.title)[0]??'',tags,durationMs:Number(properties.durationMs??Number(properties.duration??0)*1000),recordingId:tag(['musicbrainzrecordingid','musicbrainztrackid']),releaseGroupId:tag(['musicbrainzreleasegroupid'])};
}
export const reviewIdentityHash=(identity:ReviewIdentity)=>createHash('sha256').update(JSON.stringify({artist:identity.artist,title:identity.title,duration:identity.durationMs,recordingId:identity.recordingId,group:identity.releaseGroupId})).digest('hex');
export function recordingFacts(identity:ReviewIdentity,recording:Recording):ExternalTrackFact[]{
  const titles=[recording.title,...(recording.aliases??[]).map(a=>a.name)];
  if(!uuid.test(recording.id)||!titles.some(t=>identityName(t)===identityName(identity.title))||
    !trackArtistMatches((recording['artist-credit']??[]).map(c=>c.name??c.artist.name),identity.artist,identity.tags.artist))return[];
  if(identity.recordingId&&identity.recordingId!==recording.id)return[];
  // A title/artist coincidence cannot bind another performance of the song.
  if(!identity.durationMs||!recording.length||Math.abs(identity.durationMs-recording.length)>Math.max(2000,identity.durationMs*.01))return[];
  const url=`https://musicbrainz.org/recording/${recording.id}`,facts:ExternalTrackFact[]=[{field:'recordingId',value:recording.id,scope:'recording',url}];
  const instruments=[...new Set((recording.relations??[]).filter(r=>r.type==='instrument').flatMap(r=>r.attributes??[]).map(v=>canonicalSemanticValue('instrumentation',v)))];
  if(instruments.length)facts.push({field:'instrumentation',value:instruments,scope:'recording',url});
  if(recording.relations?.some(r=>r.type==='vocal'))facts.push({field:'vocalPresence',value:true,scope:'recording',url});
  if(recording.genres?.length)facts.push({field:'genre',value:recording.genres.map(g=>canonicalSemanticValue('genre',g.name)),scope:'recording',url});
  if(recording['first-release-date'])facts.push({field:'originalDate',value:recording['first-release-date'],scope:'recording',url});
  return facts;
}
async function loadRecordingFacts(identity:ReviewIdentity){
  const request=<T>(path:string,key:string)=>cachedJson<T>('musicbrainz',key,`playlist-track:${identity.fileId}`,30,()=>withMusicBrainzRequestLimit(()=>fetchJson<T>('https://musicbrainz.org/ws/2/'+path,{headers:{Accept:'application/json','User-Agent':'MusicCurator/3.0 (+https://curator.blizzard.busykoala.io/)'}},1)));
  let id=identity.recordingId;
  if(!id){
    if(!identity.releaseGroupId)return[];
    const query=`recording:${JSON.stringify(identity.title)} AND artist:${JSON.stringify(identity.artist)} AND rgid:${identity.releaseGroupId}`;
    const result=await request<{recordings:Recording[]}>('recording?query='+encodeURIComponent(query)+'&limit=8&fmt=json','playlist-recording-search:'+reviewIdentityHash(identity));
    const exact=result.recordings.filter(r=>recordingFacts(identity,r).length);
    if(exact.length!==1)return[];id=exact[0].id;
  }
  const recording=await request<Recording>(`recording/${id}?inc=artist-credits+artist-rels+aliases+genres&fmt=json`,'playlist-recording-facts:v1:'+id);
  return recordingFacts({...identity,recordingId:id},recording);
}
export function queueMetadataReview(fileId:number,reason:string,priority=0){
  const row=db().prepare('SELECT id,artist_name,tags_json,properties_json FROM files WHERE id=?').get(fileId) as Parameters<typeof reviewIdentity>[0]|undefined;if(!row)return;
  const hash=reviewIdentityHash(reviewIdentity(row));
  db().prepare(`INSERT INTO playlist_metadata_reviews(file_id,reason,priority,source_hash,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(file_id) DO UPDATE SET reason=excluded.reason,priority=max(priority,excluded.priority),
    status=CASE WHEN source_hash<>excluded.source_hash THEN 'queued' ELSE status END,
    facts_json=CASE WHEN source_hash<>excluded.source_hash THEN '[]' ELSE facts_json END,
    source_hash=excluded.source_hash,next_retry_at=CASE WHEN source_hash<>excluded.source_hash THEN 0 ELSE next_retry_at END,updated_at=excluded.updated_at`).run(fileId,reason,priority,hash,Date.now());
}
export function seedMetadataReviews(){
  // Active selections and recent imports only. The full library is never
  // invalidated or reclassified by a metadata policy version change.
  const watermark=Number(stateGet('playlist_metadata_file_watermark','0'));
  if(!watermark)stateSet('playlist_metadata_file_watermark',String((db().prepare('SELECT coalesce(max(id),0) id FROM files').get() as {id:number}).id));
  const after=watermark||Number(stateGet('playlist_metadata_file_watermark','0'));
  const rows=db().prepare(`SELECT f.id,CASE WHEN i.file_id IS NOT NULL THEN 10 ELSE 5 END priority FROM files f
    LEFT JOIN playlist_items i ON i.file_id=f.id AND i.run_id IN (SELECT max(id) FROM playlist_runs WHERE status='complete' AND preview=0 GROUP BY playlist_id)
    WHERE f.status='written' AND (i.file_id IS NOT NULL OR f.id>?)
    AND NOT EXISTS (SELECT 1 FROM playlist_metadata_reviews r WHERE r.file_id=f.id)
    GROUP BY f.id ORDER BY priority DESC,f.id LIMIT 100`).all(after) as Array<{id:number;priority:number}>;
  for(const row of rows)queueMetadataReview(row.id,'Improve active selection/new import recording evidence',row.priority);
  // Priority sorting can enqueue a high-ID active song before older imports.
  // Advance only over a contiguous reviewed prefix, never past those gaps.
  const pending=db().prepare(`SELECT min(f.id) id FROM files f WHERE f.id>? AND NOT EXISTS
    (SELECT 1 FROM playlist_metadata_reviews r WHERE r.file_id=f.id)`).get(after) as {id:number|null};
  const maximum=(db().prepare('SELECT coalesce(max(id),0) id FROM files').get() as {id:number}).id;
  stateSet('playlist_metadata_file_watermark',String(pending.id==null?maximum:pending.id-1));
  return rows.length;
}
export async function runMetadataReviews(load=loadRecordingFacts,limit=10){
  let reviewed=0;
  for(let i=0;i<Math.min(100,limit);i++){
    if(stateGet('paused')==='true'||db().prepare("SELECT 1 FROM playlist_chat_jobs WHERE status IN ('queued','running') LIMIT 1").get())break;
    const now=Date.now(),token=randomUUID(),day=new Date(now).setUTCHours(0,0,0,0);
    const claim=db().transaction(()=>{
      if((db().prepare('SELECT count(*) n FROM playlist_metadata_review_attempts WHERE created_at>=?').get(day) as {n:number}).n>=100)return null;
      const row=db().prepare(`SELECT r.file_id,f.artist_name,f.tags_json,f.properties_json FROM playlist_metadata_reviews r JOIN files f ON f.id=r.file_id
        WHERE r.status IN ('queued','retry','running','complete') AND r.next_retry_at<=? AND r.lease_until<=? ORDER BY r.priority DESC,r.updated_at,r.file_id LIMIT 1`).get(now,now) as {file_id:number;artist_name:string;tags_json:string;properties_json:string}|undefined;
      if(!row)return null;
      db().prepare("UPDATE playlist_metadata_reviews SET status='running',lease_token=?,lease_until=? WHERE file_id=?").run(token,now+120000,row.file_id);
      db().prepare('INSERT INTO playlist_metadata_review_attempts(file_id,created_at) VALUES(?,?)').run(row.file_id,now);
      return reviewIdentity({...row,id:row.file_id});
    }).immediate();
    if(!claim)break;
    try{
      const facts=await load(claim),current=db().prepare('SELECT id,artist_name,tags_json,properties_json FROM files WHERE id=?').get(claim.fileId) as Parameters<typeof reviewIdentity>[0]|undefined;
      if(!current||reviewIdentityHash(reviewIdentity(current))!==reviewIdentityHash(claim))throw Error('Recording identity changed during evidence review');
      db().prepare("UPDATE playlist_metadata_reviews SET status=?,source_hash=?,facts_json=?,next_retry_at=?,error='',lease_token=NULL,lease_until=0,updated_at=? WHERE file_id=? AND lease_token=? AND lease_until>?")
        .run(facts.length?'complete':'retry',reviewIdentityHash(claim),JSON.stringify(facts),facts.length?Date.now()+30*86400_000:Date.now()+7*86400_000,Date.now(),claim.fileId,token,Date.now());
      reviewed++;
    }catch(error){db().prepare("UPDATE playlist_metadata_reviews SET status='retry',next_retry_at=?,error=?,lease_token=NULL,lease_until=0,updated_at=? WHERE file_id=? AND lease_token=?").run(Date.now()+3600_000,String(error).slice(0,300),Date.now(),claim.fileId,token)}
  }
  return reviewed;
}
