import {randomUUID,createHash} from 'node:crypto';
import {db,stateGet,stateSet} from '@/features/db/client';
import {config} from '@/config';
import {latestScheduledDate,scheduledDateInstant,isAuthenticationFailure,refreshRetryDelays,type PlaylistRefreshMode} from './refresh-policy';
import {getPlaylist} from './repository';

export const refreshLeaseMs=10*60_000;
const inferenceAuthentication=(error:string)=>isAuthenticationFailure(error)&&/local AI|inference/i.test(error);
const inferenceCredentialsRevision=()=>createHash('sha256').update(JSON.stringify([config.CURATOR_AI_BASE_URL,config.CURATOR_AI_MODEL,config.CURATOR_AI_API_KEY])).digest('hex');
const nativeCredentialsRevision=(ownerId:number)=>createHash('sha256').update(JSON.stringify(db().prepare('SELECT token_ciphertext,token_iv,token_tag FROM curator_users WHERE id=?').get(ownerId)??null)).digest('hex');
export type PlaylistRefreshJob={id:string;playlist_id:number;owner_user_id:number;scheduled_date:string;kind:string;revision:number;mode:string;status:string;phase:string;attempts:number;next_attempt_at:number;lease_token:string|null;lease_until:number;run_id:number|null;error:string;result_json:string};
export function playlistRefreshMode():PlaylistRefreshMode{
  const mode=stateGet('playlist_refresh_mode','off');
  return ['shadow','canary','enabled'].includes(mode)?mode as PlaylistRefreshMode:'off';
}
export function refreshManaged(id:number,mode=playlistRefreshMode()){
  return mode==='enabled'||mode==='canary'&&stateGet('playlist_refresh_canary_ids','6').split(',').map(Number).includes(id);
}
export function scheduleRefreshJobs(now=new Date()){
  const mode=playlistRefreshMode();if(mode==='off'||stateGet('paused')==='true')return 0;
  const date=latestScheduledDate(now),stamp=now.getTime(),scheduled=scheduledDateInstant(date);
  return db().transaction(()=>{
    let inserted=0;
    db().prepare("UPDATE playlist_refresh_jobs SET status='superseded',updated_at=? WHERE scheduled_date<? AND kind IN ('nightly','shadow') AND status IN ('queued','retry','auth_wait')").run(stamp,date);
    const playlists=db().prepare('SELECT id,owner_user_id,revision,last_run_at,created_at FROM smart_playlists WHERE enabled=1 AND owner_user_id IS NOT NULL ORDER BY id').all() as Array<{id:number;owner_user_id:number;revision:number;last_run_at:string|null;created_at:string}>;
    for(const p of playlists){
      if(mode!=='shadow'&&!refreshManaged(p.id,mode))continue;
      // A playlist created after the most recent scheduled night first runs on
      // the next night. Existing playlists get one catch-up, never a backlog.
      if(Date.parse(p.created_at.replace(' ','T')+'Z')>scheduled)continue;
      if(mode!=='shadow'&&p.last_run_at){
        if(Date.parse(p.last_run_at.replace(' ','T')+'Z')>=scheduled)continue;
      }
      inserted+=db().prepare(`INSERT INTO playlist_refresh_jobs(id,playlist_id,owner_user_id,scheduled_date,kind,revision,mode,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(playlist_id,scheduled_date,kind) DO UPDATE SET revision=excluded.revision,owner_user_id=excluded.owner_user_id,status='queued',phase='generate',run_id=NULL,attempts=0,next_attempt_at=0,error='',updated_at=excluded.updated_at
        WHERE playlist_refresh_jobs.status='superseded' AND playlist_refresh_jobs.revision<>excluded.revision`)
        .run(randomUUID(),p.id,p.owner_user_id,date,mode==='shadow'?'shadow':'nightly',p.revision,mode,stamp,stamp).changes;
    }
    return inserted;
  }).immediate();
}
export function claimRefreshJob(now=Date.now()):PlaylistRefreshJob|null{
  const mode=playlistRefreshMode();if(mode==='off')return null;
  return db().transaction(()=>{
    // Cancel stale queued proposals. A running publication retains its lease
    // until it can verify/roll back; its revision is fenced at the native API.
    db().prepare("UPDATE playlist_refresh_jobs SET status='superseded',updated_at=? WHERE status IN ('queued','retry','auth_wait') AND NOT EXISTS (SELECT 1 FROM smart_playlists p WHERE p.id=playlist_id AND (p.enabled=1 OR kind LIKE 'manual:%') AND p.revision=playlist_refresh_jobs.revision AND p.owner_user_id=playlist_refresh_jobs.owner_user_id)").run(now);
    db().prepare("UPDATE playlist_refresh_jobs SET status='retry',lease_token=NULL,lease_until=0,updated_at=? WHERE status='running' AND lease_until<=?").run(now,now);
    const auth=db().prepare("SELECT j.id,j.error,j.owner_user_id,u.token_status,u.last_seen_at>datetime(j.updated_at/1000,'unixepoch') renewed FROM playlist_refresh_jobs j JOIN smart_playlists p ON p.id=j.playlist_id JOIN curator_users u ON u.id=p.owner_user_id WHERE j.status='auth_wait'").all() as Array<{id:string;error:string;owner_user_id:number;token_status:string;renewed:number}>;
    for(const j of auth){
      const previous=stateGet('playlist_refresh_native_auth:'+j.id);
      const renewed=inferenceAuthentication(j.error)?stateGet('playlist_refresh_inference_auth:'+j.id)!==inferenceCredentialsRevision():j.token_status==='active'&&(previous?previous!==nativeCredentialsRevision(j.owner_user_id):Boolean(j.renewed));
      if(renewed)db().prepare("UPDATE playlist_refresh_jobs SET status='retry',next_attempt_at=0 WHERE id=?").run(j.id);
    }
    // Interactive work and any active mutation lease take priority.
    const rows=db().prepare(`SELECT j.* FROM playlist_refresh_jobs j WHERE j.status IN ('queued','retry') AND j.next_attempt_at<=?
      AND NOT EXISTS (SELECT 1 FROM playlist_chat_jobs c WHERE c.playlist_id=j.playlist_id AND c.status IN ('queued','running'))
      AND NOT EXISTS (SELECT 1 FROM playlist_chat_state s WHERE s.playlist_id=j.playlist_id AND s.lease_until>?)
      ORDER BY j.created_at,j.id`).all(now,now) as PlaylistRefreshJob[];
    const row=rows.find(job=>job.mode==='shadow'?mode==='shadow':mode!=='shadow'&&refreshManaged(job.playlist_id,mode));
    if(!row)return null;
    const token=randomUUID();
    db().prepare("UPDATE playlist_refresh_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?").run(token,now+refreshLeaseMs,now,row.id);
    return {...row,status:'running',attempts:row.attempts+1,lease_token:token,lease_until:now+refreshLeaseMs};
  }).immediate();
}
export function heartbeatRefreshJob(job:PlaylistRefreshJob,now=Date.now()){
  return db().transaction(()=>{
    const changed=db().prepare("UPDATE playlist_refresh_jobs SET lease_until=?,updated_at=? WHERE id=? AND lease_token=? AND status='running' AND lease_until>?").run(now+refreshLeaseMs,now,job.id,job.lease_token,now).changes;
    if(changed)db().prepare('UPDATE playlist_chat_state SET lease_until=? WHERE playlist_id=? AND lease=? AND lease_until>?').run(now+refreshLeaseMs,job.playlist_id,job.lease_token,now);
    return Boolean(changed);
  })();
}
export function assertRefreshCurrent(job:PlaylistRefreshJob,now=Date.now()){
  const p=getPlaylist(job.playlist_id),live=db().prepare("SELECT 1 FROM playlist_refresh_jobs WHERE id=? AND status='running' AND lease_token=? AND lease_until>?").get(job.id,job.lease_token,now);
  if(!live||!p||!p.enabled&&!job.kind.startsWith('manual:')||p.revision!==job.revision||p.ownerUserId!==job.owner_user_id)throw new Error('Playlist settings changed; refresh superseded');
  return p;
}
export function requestPlaylistRefresh(playlistId:number,ownerId:number,requestId:string,retry=false){
  return db().transaction(()=>{
    const playlist=getPlaylist(playlistId);
    if(!playlist||playlist.ownerUserId!==ownerId)throw Error('Playlist not found');
    if(!refreshManaged(playlistId))throw Error('Background playlist refresh is not enabled yet');
    const receipt=db().prepare('SELECT playlist_id,owner_user_id,job_id FROM playlist_refresh_requests WHERE request_id=?').get(requestId) as {playlist_id:number;owner_user_id:number;job_id:string}|undefined;
    if(receipt){if(receipt.playlist_id!==playlistId||receipt.owner_user_id!==ownerId)throw Error('Refresh request ID is already in use');return receipt.job_id}
    const remember=(jobId:string)=>{db().prepare('INSERT INTO playlist_refresh_requests(request_id,playlist_id,owner_user_id,job_id) VALUES(?,?,?,?)').run(requestId,playlistId,ownerId,jobId);return jobId};
    const duplicate=db().prepare('SELECT id,playlist_id,owner_user_id FROM playlist_refresh_jobs WHERE id=?').get(requestId) as {id:string;playlist_id:number;owner_user_id:number}|undefined;
    if(duplicate){if(duplicate.playlist_id!==playlistId||duplicate.owner_user_id!==ownerId)throw Error('Refresh request ID is already in use');return remember(duplicate.id)}
    const active=db().prepare("SELECT id,status,revision,run_id,phase FROM playlist_refresh_jobs WHERE playlist_id=? AND owner_user_id=? AND status IN ('queued','running','retry','auth_wait','failed') AND kind<>'shadow' ORDER BY created_at DESC LIMIT 1").get(playlistId,ownerId) as {id:string;status:string;revision:number;run_id:number|null;phase:string}|undefined;
    if(active?.status==='queued'||active?.status==='running')return remember(active.id);
    if(retry&&active&&active.revision===playlist.revision){
      if(active.status==='auth_wait'&&playlist.ownerTokenStatus!=='active')throw Error('Sign in to Navidrome again before retrying');
      const run=active.run_id?db().prepare('SELECT detail_json FROM playlist_runs WHERE id=?').get(active.run_id) as {detail_json:string}|undefined:undefined;
      const regenerate=Boolean(run&&JSON.parse(run.detail_json).evaluation?.shortage);
      db().prepare("UPDATE playlist_refresh_jobs SET status='retry',next_attempt_at=0,attempts=0,run_id=?,phase=?,updated_at=? WHERE id=?").run(regenerate?null:active.run_id,regenerate?'generate':active.phase,Date.now(),active.id);
      return remember(active.id);
    }
    if(active)db().prepare("UPDATE playlist_refresh_jobs SET status='superseded',updated_at=? WHERE id=?").run(Date.now(),active.id);
    const now=Date.now();
    db().prepare(`INSERT INTO playlist_refresh_jobs(id,playlist_id,owner_user_id,scheduled_date,kind,revision,mode,created_at,updated_at) VALUES(?,?,?,?,?,?,'enabled',?,?)`)
      .run(requestId,playlistId,ownerId,latestScheduledDate(new Date(now)),'manual:'+requestId,playlist.revision,now,now);
    return remember(requestId);
  }).immediate();
}
export function finishRefreshJob(job:PlaylistRefreshJob,result:Record<string,unknown>,error='',now=Date.now()){
  let status=error?(isAuthenticationFailure(error)?'auth_wait':'failed'):'completed',next=0;
  if(/superseded|settings changed/i.test(error))status='superseded';
  else if(error&&status!=='auth_wait'&&job.attempts<=refreshRetryDelays.length){status='retry';next=now+refreshRetryDelays[job.attempts-1]}
  return db().transaction(()=>{
    const changed=db().prepare("UPDATE playlist_refresh_jobs SET status=?,next_attempt_at=?,result_json=?,error=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND status='running' AND lease_token=? AND lease_until>?")
      .run(status,next,JSON.stringify(result),error,now,job.id,job.lease_token,now).changes>0;
    if(changed&&status==='auth_wait'&&inferenceAuthentication(error))stateSet('playlist_refresh_inference_auth:'+job.id,inferenceCredentialsRevision());
    else if(changed&&status==='auth_wait')stateSet('playlist_refresh_native_auth:'+job.id,nativeCredentialsRevision(job.owner_user_id));
    return changed;
  }).immediate();
}
