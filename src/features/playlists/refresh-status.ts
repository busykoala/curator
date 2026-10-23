import {db,stateGet} from '@/features/db/client';
import {nextZurichRunSql} from './schedule-time';
import type {PlaylistDefinition} from './types';

export type PlaylistRefreshView={
  lastSuccessfulRefresh:string|null;nextRefresh:string|null;
  refreshStatus:'disabled'|'ready'|'queued'|'refreshing'|'retrying'|'auth_required'|'failed';
  refreshAuthService:'navidrome'|'inference'|null;
  shortage:number;changeSummary:string;refreshError:string;pendingDiscoveries:number;refreshPipelineEnabled:boolean;
  listeningHistoryStatus:'current'|'stale'|'unavailable'|null;listeningHistoryCapturedAt:string|null;
};
const iso=(value:string|null)=>value?new Date(value.includes('T')?value:value.replace(' ','T')+'Z').toISOString():null;
export function playlistRefreshView(playlist:Pick<PlaylistDefinition,'id'|'ownerUserId'|'enabled'|'lastRunAt'>,now=new Date()):PlaylistRefreshView{
  const mode=stateGet('playlist_refresh_mode','off'),managed=mode==='enabled'||mode==='canary'&&stateGet('playlist_refresh_canary_ids','6').split(',').map(Number).includes(playlist.id);
  const published=db().prepare("SELECT finished_at,detail_json FROM playlist_runs WHERE playlist_id=? AND owner_user_id=? AND preview=0 AND status='complete' ORDER BY id DESC LIMIT 1").get(playlist.id,playlist.ownerUserId) as {finished_at:string|null;detail_json:string}|undefined;
  const job=db().prepare("SELECT j.*,r.detail_json FROM playlist_refresh_jobs j LEFT JOIN playlist_runs r ON r.id=j.run_id WHERE j.playlist_id=? AND j.owner_user_id=? AND j.kind<>'shadow' ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1").get(playlist.id,playlist.ownerUserId) as {status:string;next_attempt_at:number;error:string;detail_json:string|null;updated_at:number}|undefined;
  const detail=JSON.parse(published?.detail_json??'{}'),attempt=JSON.parse(job?.detail_json??'{}');
  const listeningHistoryStatus=detail.listener?detail.listener.stale?'stale':detail.listener.complete?'current':'unavailable':null;
  const captured=detail.listener?.capturedAt;
  const listeningHistoryCapturedAt=typeof captured==='string'&&Number.isFinite(Date.parse(captured))?captured:null;
  const shortage=job&&job.status!=='completed'?Number(attempt.evaluation?.shortage??0):0;
  const lastSuccessfulRefresh=iso(published?.finished_at??playlist.lastRunAt);
  const completed=db().prepare("SELECT coalesce(max(updated_at),0) at FROM playlist_refresh_jobs WHERE playlist_id=? AND owner_user_id=? AND kind<>'shadow' AND status='completed'").get(playlist.id,playlist.ownerUserId) as {at:number};
  const successAt=Math.max(completed.at,lastSuccessfulRefresh?Date.parse(lastSuccessfulRefresh):0);
  const unresolved=db().prepare(`SELECT error FROM playlist_refresh_jobs WHERE playlist_id=? AND owner_user_id=? AND kind<>'shadow' AND error<>'' AND status<>'completed'
    AND revision=(SELECT revision FROM smart_playlists WHERE id=?) AND updated_at>? ORDER BY updated_at DESC,rowid DESC LIMIT 1`).get(playlist.id,playlist.ownerUserId,playlist.id,successAt) as {error:string}|undefined;
  const active=managed&&job&&['queued','running','retry','auth_wait','failed'].includes(job.status);
  const refreshStatus:PlaylistRefreshView['refreshStatus']=active?
    job.status==='queued'?'queued':job.status==='running'?'refreshing':job.status==='retry'?'retrying':job.status==='auth_wait'?'auth_required':'failed':playlist.enabled?'ready':'disabled';
  const refreshAuthService=refreshStatus==='auth_required'?/local AI|inference/i.test(job?.error??'')?'inference':'navidrome':null;
  const nextRefresh=!playlist.enabled?null:refreshStatus==='auth_required'?null:
    active&&['queued','running','retry'].includes(job.status)?new Date(job.next_attempt_at||now.getTime()).toISOString():iso(nextZurichRunSql(now));
  const count=Number(detail.evaluation?.changed??detail.tracks??0);
  let changeSummary=published?(count?`${count} ${count===1?'song':'songs'} refreshed`:'Mix checked · no song changes'):'Ready for a first mix';
  if(shortage)changeSummary='Kept the previous mix: insufficient matching tracks';
  else if(refreshStatus==='refreshing')changeSummary='Refreshing your mix · you can leave';
  else if(refreshStatus==='queued')changeSummary='Refresh queued · you can leave';
  else if(refreshStatus==='retrying')changeSummary='Refresh will retry automatically';
  else if(refreshStatus==='auth_required')changeSummary=refreshAuthService==='inference'?'The AI connection needs renewed credentials':'Sign in to Navidrome again to refresh';
  else if(refreshStatus==='failed')changeSummary='The last refresh needs a retry';
  const pending=(db().prepare("SELECT count(*) n FROM playlist_discovery_recommendations WHERE playlist_id=? AND owner_user_id=? AND status IN ('queued','downloading','deferred')").get(playlist.id,playlist.ownerUserId) as {n:number}).n;
  return{lastSuccessfulRefresh,nextRefresh,refreshStatus,refreshAuthService,shortage,changeSummary,refreshError:managed?(active&&job.error||unresolved?.error||''):'',pendingDiscoveries:pending,refreshPipelineEnabled:managed,listeningHistoryStatus,listeningHistoryCapturedAt};
}
