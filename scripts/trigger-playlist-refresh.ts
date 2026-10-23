// Deliberate production refreshes use the same durable queue as the UI. This
// operator never changes schedules, enablement, revisions or retry timestamps.
import {mkdirSync,writeFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {config} from '../src/config';
import {db,stateGet} from '../src/features/db/client';
import {requestPlaylistRefresh,scheduleRefreshJobs} from '../src/features/playlists/refresh-jobs';

const batch=process.env.PLAYLIST_REFRESH_BATCH;
if(config.DATABASE_PATH!=='/app/data/curator.sqlite'||process.env.PLAYLIST_ROLLOUT_APPLY!=='true'||stateGet('playlist_refresh_mode')!=='enabled'||stateGet('paused')==='true')throw Error('Production path, apply, enabled-mode or pause guard failed');
if(!batch||!/^[a-zA-Z0-9_-]{8,100}$/.test(batch))throw Error('Supply a stable batch name to make repeated invocations idempotent');
const database=db();
try{
  const requests=database.transaction(()=>{
    scheduleRefreshJobs();
    const definitions=database.prepare('SELECT id,owner_user_id,revision FROM smart_playlists WHERE enabled=1 AND owner_user_id IS NOT NULL ORDER BY id').all() as Array<{id:number;owner_user_id:number;revision:number}>;
    if(!definitions.length)throw Error('There are no enabled playlists');
    return definitions.map(p=>{
      // Preserve the already-triggered, checked canary rather than rotate it twice.
      const canaryId=p.id===6?process.env.PLAYLIST_REFRESH_CANARY_JOB:undefined;
      const existing=canaryId?database.prepare("SELECT id FROM playlist_refresh_jobs WHERE id=? AND playlist_id=? AND owner_user_id=? AND revision=? AND mode<>'shadow' AND status='completed'").get(canaryId,p.id,p.owner_user_id,p.revision) as {id:string}|undefined:undefined;
      if(canaryId&&!existing)throw Error('The supplied canary is not a completed job for the current owner and revision');
      const jobId=existing?.id??requestPlaylistRefresh(p.id,p.owner_user_id,batch+':'+p.owner_user_id+':'+p.id+':'+p.revision);
      const job=database.prepare('SELECT created_at FROM playlist_refresh_jobs WHERE id=?').get(jobId) as {created_at:number};
      return{playlistId:p.id,ownerId:p.owner_user_id,revision:p.revision,jobId,requestedAt:new Date(job.created_at).toISOString()};
    });
  }).immediate();
  const output=process.env.PLAYLIST_OBSERVER_OUTPUT??'/app/data/playlist-renewal-private/observations';
  mkdirSync(output,{recursive:true,mode:0o700});chmodSync(output,0o700);
  const path=join(output,batch+'-requests.json');
  writeFileSync(path,JSON.stringify({batch,kind:'triggered',createdAt:new Date().toISOString(),requests},null,2),{mode:0o600});chmodSync(path,0o600);
  console.log(JSON.stringify({path,batch,requests}));
}finally{database.close()}
