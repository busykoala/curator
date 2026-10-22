import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {config} from '@/config';import {db,stateSet} from '@/features/db/client';
import {createPlaylist,getPlaylist,markRun} from './repository';
import {requestPlaylistRefresh,claimRefreshJob,assertRefreshCurrent,finishRefreshJob,scheduleRefreshJobs} from './refresh-jobs';
const directory=mkdtempSync(join(tmpdir(),'curator-refresh-status-'));config.DATABASE_PATH=join(directory,'db.sqlite');const database=db();
database.exec("INSERT INTO curator_users(id,navidrome_user_id,username,display_name,token_status) VALUES(1,'one','one','One','active'),(2,'two','two','Two','active')");
const p=createPlaylist({name:'Same name',category:'mood',enabled:true,ownerUserId:1,config:{}}),other=createPlaylist({name:'Same name',category:'mood',enabled:false,ownerUserId:2,config:{}});
test.beforeEach(()=>{database.exec('DELETE FROM playlist_refresh_jobs;DELETE FROM playlist_runs');stateSet('playlist_refresh_mode','enabled')});
test('a disabled playlist has no next run, including after explicit publication',()=>{
  markRun(other.id);const view=getPlaylist(other.id)!;
  assert.equal(view.enabled,false);assert.equal(view.nextRunAt,null);assert.equal(view.nextRefresh,null);assert.equal(view.refreshStatus,'disabled');
});
test('manual refresh is idempotent, owner-scoped, durable and does not enable a disabled playlist',()=>{
  const request=randomUUID(),id=requestPlaylistRefresh(other.id,2,request);
  assert.throws(()=>requestPlaylistRefresh(other.id,1,randomUUID()),/not found/);
  scheduleRefreshJobs(new Date(Date.now()+3*86400_000));
  const job=claimRefreshJob()!;assert.equal(job.id,id);assertRefreshCurrent(job);finishRefreshJob(job,{published:true});
  assert.equal(requestPlaylistRefresh(other.id,2,request),id);assert.equal(getPlaylist(other.id)!.enabled,false);assert.equal(getPlaylist(other.id)!.nextRefresh,null);
  assert.throws(()=>requestPlaylistRefresh(p.id,1,request),/already in use/);
});
test('retry status and error persist until success; repeated retry requests do not publish twice',()=>{
  const id=requestPlaylistRefresh(p.id,1,randomUUID()),job=claimRefreshJob()!;assert.equal(job.id,id);
  finishRefreshJob(job,{},'Temporary dependency failure');let view=getPlaylist(p.id)!;
  assert.equal(view.refreshStatus,'retrying');assert.ok(view.nextRefresh);assert.equal(view.refreshError,'Temporary dependency failure');
  const request=randomUUID();assert.equal(requestPlaylistRefresh(p.id,1,request,true),id);assert.equal(getPlaylist(p.id)!.refreshError,'Temporary dependency failure');
  const retry=claimRefreshJob()!;finishRefreshJob(retry,{published:true});
  assert.equal(requestPlaylistRefresh(p.id,1,request,true),id);assert.equal(getPlaylist(p.id)!.refreshError,'');
});
test('a shortage retry regenerates the proposal and authentication waits have no promised run time',()=>{
  const id=requestPlaylistRefresh(p.id,1,randomUUID()),job=claimRefreshJob()!;
  const run=database.prepare("INSERT INTO playlist_runs(playlist_id,owner_user_id,config_hash,status,preview,detail_json) VALUES(?,1,'fixture','complete',1,'{\"evaluation\":{\"shortage\":3}}') RETURNING id").get(p.id) as {id:number};
  database.prepare("UPDATE playlist_refresh_jobs SET run_id=?,phase='publish' WHERE id=?").run(run.id,id);finishRefreshJob(job,{},'Insufficient matching tracks');
  assert.equal(getPlaylist(p.id)!.shortage,3);assert.match(getPlaylist(p.id)!.changeSummary!,/Kept the previous mix/);
  requestPlaylistRefresh(p.id,1,randomUUID(),true);assert.deepEqual(database.prepare('SELECT run_id,phase FROM playlist_refresh_jobs WHERE id=?').get(id),{run_id:null,phase:'generate'});
  const retry=claimRefreshJob()!;finishRefreshJob(retry,{},'Playlist owner must sign in to Navidrome again');
  assert.equal(getPlaylist(p.id)!.refreshStatus,'auth_required');assert.equal(getPlaylist(p.id)!.nextRefresh,null);
});
test.after(()=>{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
