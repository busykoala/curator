import {db,stateGet,stateSet} from '@/features/db/client';
import {acquireChatLease,releaseChatLease} from './chat-state';
import {generatePlaylist,savePlaylistPreview} from './generate';
import {assertRefreshCurrent,claimRefreshJob,finishRefreshJob,heartbeatRefreshJob,playlistRefreshMode,scheduleRefreshJobs} from './refresh-jobs';

export async function runNextRefreshJob(dependencies={generate:generatePlaylist,publish:savePlaylistPreview}){
  if(playlistRefreshMode()==='off'||stateGet('paused')==='true')return false;
  const job=claimRefreshJob();if(!job)return false;
  let acquired=false;
  const timer=setInterval(()=>heartbeatRefreshJob(job),15_000);
  try{
    acquireChatLease(job.playlist_id,undefined,job.lease_token!);acquired=true;
    assertRefreshCurrent(job);
    let runId=job.run_id;
    if(!runId){
      const generated=await dependencies.generate(job.playlist_id,true,job.lease_token!,true,job.mode==='shadow'?'shadow':'background');
      assertRefreshCurrent(job);runId=generated.runId;
      const updated=db().prepare("UPDATE playlist_refresh_jobs SET run_id=?,phase='publish',updated_at=? WHERE id=? AND lease_token=? AND lease_until>?")
        .run(runId,Date.now(),job.id,job.lease_token,Date.now());
      if(!updated.changes)throw new Error('Refresh lease expired; proposal superseded');
    }
    assertRefreshCurrent(job);
    if(job.mode==='shadow'){
      const preview=db().prepare('SELECT detail_json FROM playlist_runs WHERE id=?').get(runId) as {detail_json:string};
      finishRefreshJob(job,{previewRunId:runId,unpublished:true,...JSON.parse(preview.detail_json)});
    }else{
      const published=await dependencies.publish(job.playlist_id,runId,job.lease_token!);
      assertRefreshCurrent(job);
      finishRefreshJob(job,{previewRunId:runId,published:true,...published.detail,tracks:published.items.length});
    }
    console.log(JSON.stringify({event:'playlist_refresh_complete',playlistId:job.playlist_id,scheduledDate:job.scheduled_date,mode:job.mode,at:new Date().toISOString()}));
  }catch(error){
    finishRefreshJob(job,{},error instanceof Error?error.message:String(error));
    console.error(JSON.stringify({event:'playlist_refresh_failed',playlistId:job.playlist_id,error:String(error),at:new Date().toISOString()}));
  }finally{
    clearInterval(timer);if(acquired)releaseChatLease(job.playlist_id,job.lease_token!);
  }
  return true;
}

export function pollPlaylistRefreshSchedule(now=new Date()){
  stateSet('playlist_refresh_heartbeat',now.toISOString());
  return scheduleRefreshJobs(now);
}
