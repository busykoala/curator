import {randomUUID} from 'node:crypto';
import {db,stateGet,stateSet} from '@/features/db/client';
import {jellyfinCall} from '@/features/auth/navidrome';
import {aiClient} from '@/features/ai/client';
import {getPlaylist} from './repository';
import {playlistAttemptRecorder} from './inference-metrics';
import {isAuthenticationFailure} from './refresh-policy';
import {playlistRefreshMode} from './refresh-jobs';

type Dependency='navidrome'|'inference'|'both';
type WaitingJob={id:string;playlist_id:number;owner_user_id:number;error:string;updated_at:number};
export function failedRefreshDependency(error:string):Dependency|null{
  if(isAuthenticationFailure(error)||/\b429\b|shortage|insufficient|constraint|verification failed|invalid JSON|structured output|identity remains unresolved/i.test(error))return null;
  if(!/\b50[0234]\b|\b408\b|fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|TimeoutError|timed out|temporarily unavailable|no router for requested model/i.test(error))return null;
  return /Navidrome/i.test(error)?'navidrome':/Local AI|model route|inference/i.test(error)?'inference':'both';
}
async function probeInference(playlistId:number){
  const playlist=getPlaylist(playlistId);if(!playlist)throw Error('Playlist removed');
  const result=await aiClient.structured<{ready:boolean}>({input:'Return ready true.',schemaName:'playlist_dependency_health',schema:{type:'object',additionalProperties:false,required:['ready'],properties:{ready:{type:'boolean'}}},maxOutputTokens:16,deadlineMs:30_000,priority:'background',onAttempt:playlistAttemptRecorder(playlist,'dependency-health')});
  if(result.data.ready!==true)throw Error('Inference probe did not return the expected structured response');
}
const defaultProbes={navidrome:async(ownerId:number)=>{await jellyfinCall(ownerId,'Items?IncludeItemTypes=Playlist&Limit=1&StartIndex=0')},inference:probeInference};

// Recovery checks are independent of each job's exponential retry. Probe only
// actual availability failures, at most once per five minutes, and retain the
// original error until a real refresh succeeds. A restored service may wake a
// failed job too; unchanged healthy services cannot create an infinite retry.
export async function recoverPlaylistDependencies(probes=defaultProbes,now=Date.now()){
  if(playlistRefreshMode()==='off'||stateGet('paused')==='true')return 0;
  if(db().prepare("SELECT 1 FROM playlist_chat_jobs WHERE status IN ('queued','running') LIMIT 1").get())return 0;
  const jobs=(db().prepare(`SELECT j.id,j.playlist_id,j.owner_user_id,j.error,j.updated_at FROM playlist_refresh_jobs j
    JOIN smart_playlists p ON p.id=j.playlist_id AND p.owner_user_id=j.owner_user_id AND p.revision=j.revision
    WHERE j.status IN ('retry','failed') AND j.error<>'' AND (p.enabled=1 OR j.kind LIKE 'manual:%') ORDER BY j.updated_at,j.id`).all() as WaitingJob[]).filter(job=>failedRefreshDependency(job.error));
  if(!jobs.length)return 0;
  const lease=randomUUID(),key='playlist_dependency_probe',acquired=db().transaction(()=>{
    const until=Number(stateGet(key+':until','0'));if(until>now)return false;
    stateSet(key+':until',String(now+5*60_000));stateSet(key+':lease',lease);return true;
  }).immediate();
  if(!acquired)return 0;
  let awakened=0;
  const results=new Map<string,boolean>();
  for(const job of jobs){
    const dependency=failedRefreshDependency(job.error)!;
    let available=true;
    for(const service of dependency==='both'?['navidrome','inference'] as const:[dependency]){
      const probeKey=service==='navidrome'?service+':'+job.owner_user_id:service;
      if(!results.has(probeKey)){
        try{await(service==='navidrome'?probes.navidrome(job.owner_user_id):probes.inference(job.playlist_id));results.set(probeKey,true)}
        catch{results.set(probeKey,false)}
      }
      available=available&&results.get(probeKey)!;
    }
    if(!available)continue;
    // A previous successful probe may have already retried this exact failure.
    // The row's updated_at changes on every actual attempt; wake it just once.
    const receipt=`playlist_dependency_recovered:${job.id}`;
    awakened+=db().transaction(()=>{
      if(stateGet(key+':lease')!==lease||stateGet(receipt)===String(job.updated_at))return 0;
      const changed=db().prepare("UPDATE playlist_refresh_jobs SET status='retry',next_attempt_at=0 WHERE id=? AND updated_at=? AND status IN ('retry','failed')").run(job.id,job.updated_at).changes;
      if(changed)stateSet(receipt,String(job.updated_at));return changed;
    }).immediate();
  }
  return awakened;
}
