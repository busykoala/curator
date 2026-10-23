import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db,stateSet} from '@/features/db/client';
import {createPlaylist,updatePlaylist} from './repository';
import {claimRefreshJob,finishRefreshJob,heartbeatRefreshJob,scheduleRefreshJobs,assertRefreshCurrent,requestPlaylistRefresh} from './refresh-jobs';
import {latestScheduledDate,scheduledDateInstant,refreshRetryDelays} from './refresh-policy';
import {acquireChatLease,assertPlaylistLease,releaseChatLease} from './chat-state';

const directory=mkdtempSync(join(tmpdir(),'curator-refresh-jobs-'));config.DATABASE_PATH=join(directory,'test.sqlite');
const database=db();
database.exec("INSERT INTO curator_users(id,navidrome_user_id,username,display_name) VALUES(1,'one','one','One'),(2,'two','two','Two')");
const p=createPlaylist({name:'Same name',category:'mood',ownerUserId:1,enabled:true,config:{targetTracks:2}});
const other=createPlaylist({name:'Same name',category:'mood',ownerUserId:2,enabled:false,config:{targetTracks:2}});
database.prepare("UPDATE smart_playlists SET created_at='2026-10-01 00:00:00'").run();
const at=new Date('2026-10-24T03:00:00Z');
test.beforeEach(()=>{database.exec("DELETE FROM playlist_refresh_jobs;UPDATE playlist_chat_state SET lease=NULL,lease_until=0;UPDATE smart_playlists SET last_run_at=NULL");stateSet('playlist_refresh_mode','enabled')});

test('one catch-up per playlist, disabled and new playlists are not scheduled early',()=>{
  assert.equal(scheduleRefreshJobs(at),1);assert.equal(scheduleRefreshJobs(at),0);
  const row=database.prepare('SELECT * FROM playlist_refresh_jobs').get() as Record<string,unknown>;
  assert.equal(row.playlist_id,p.id);assert.equal(row.scheduled_date,'2026-10-24');assert.equal(row.owner_user_id,1);
  database.exec("DELETE FROM playlist_refresh_jobs");
  database.prepare("UPDATE smart_playlists SET created_at='2026-10-24 06:00:00' WHERE id=?").run(p.id);
  assert.equal(scheduleRefreshJobs(new Date('2026-10-24T12:00:00Z')),0);
  database.prepare("UPDATE smart_playlists SET created_at='2026-10-01 00:00:00' WHERE id=?").run(p.id);
  database.prepare("UPDATE smart_playlists SET last_run_at='2026-10-24 02:45:00' WHERE id=?").run(p.id);
  assert.equal(scheduleRefreshJobs(at),0);
});
test('Zurich dates and 04:30 remain correct through DST transitions',()=>{
  assert.equal(latestScheduledDate(new Date('2026-10-25T03:29:00Z')),'2026-10-24');
  assert.equal(latestScheduledDate(new Date('2026-10-25T03:30:00Z')),'2026-10-25');
  assert.equal(new Date(scheduledDateInstant('2026-10-24')).toISOString(),'2026-10-24T02:30:00.000Z');
  assert.equal(new Date(scheduledDateInstant('2026-10-25')).toISOString(),'2026-10-25T03:30:00.000Z');
  assert.equal(new Date(scheduledDateInstant('2026-03-29')).toISOString(),'2026-03-29T02:30:00.000Z');
});
test('job leases recover the same checkpoint and stale workers cannot finish',()=>{
  scheduleRefreshJobs(at);const first=claimRefreshJob(at.getTime())!;assert.ok(first);
  acquireChatLease(p.id,undefined,first.lease_token!);
  database.prepare("UPDATE playlist_chat_state SET lease_until=? WHERE playlist_id=?").run(at.getTime()+100,p.id);
  const recovered=claimRefreshJob(at.getTime()+600001)!;
  assert.equal(recovered.id,first.id);assert.notEqual(recovered.lease_token,first.lease_token);
  assert.equal(finishRefreshJob(first,{},'',at.getTime()+600002),false);
  assert.equal(heartbeatRefreshJob(first,at.getTime()+600002),false);
});
test('all retry delays are persisted; authentication waits for new credentials',()=>{
  scheduleRefreshJobs(at);let now=at.getTime();
  for(const delay of refreshRetryDelays){
    const job=claimRefreshJob(now)!;assert.ok(job);assert.equal(finishRefreshJob(job,{},'Temporary service failure',now),true);
    const row=database.prepare('SELECT status,next_attempt_at FROM playlist_refresh_jobs').get() as {status:string;next_attempt_at:number};
    assert.equal(row.status,'retry');assert.equal(row.next_attempt_at,now+delay);assert.equal(claimRefreshJob(now+delay-1),null);now+=delay;
  }
  const final=claimRefreshJob(now)!;finishRefreshJob(final,{},'Temporary service failure',now);
  assert.equal((database.prepare('SELECT status FROM playlist_refresh_jobs').get() as {status:string}).status,'failed');
  database.exec('DELETE FROM playlist_refresh_jobs');scheduleRefreshJobs(at);
  const auth=claimRefreshJob(at.getTime())!;finishRefreshJob(auth,{},'Playlist owner must sign in to Navidrome again',at.getTime());
  assert.equal((database.prepare('SELECT status FROM playlist_refresh_jobs').get() as {status:string}).status,'auth_wait');
});
test('an inference authentication failure waits for model credentials, not an unrelated listener login',()=>{
  scheduleRefreshJobs(at);const now=at.getTime(),job=claimRefreshJob(now)!;
  finishRefreshJob(job,{},'Local AI request failed (401): unauthorized',now);
  database.prepare("UPDATE curator_users SET token_status='active',last_seen_at='2026-10-25 12:00:00' WHERE id=1").run();
  assert.equal(claimRefreshJob(now+1000),null);
  const previous=config.CURATOR_AI_API_KEY;config.CURATOR_AI_API_KEY=previous+'-renewed';
  try{assert.equal(claimRefreshJob(now+2000)?.id,job.id)}finally{config.CURATOR_AI_API_KEY=previous}
});
test('a native credential renewal in the same second wakes its owner’s authentication wait',()=>{
  scheduleRefreshJobs(at);const now=at.getTime(),job=claimRefreshJob(now)!;
  finishRefreshJob(job,{},'Playlist owner must sign in to Navidrome again',now);
  assert.equal(claimRefreshJob(now+100),null);
  database.prepare("UPDATE curator_users SET token_status='active',last_seen_at=?,token_ciphertext='renewed-token-fixture',token_iv='renewed-iv',token_tag='renewed-tag' WHERE id=1").run(at.toISOString().slice(0,19).replace('T',' '));
  assert.equal(claimRefreshJob(now+200)?.id,job.id);
});
test('manual mutations and refresh share one lease; config edits fence the proposal',()=>{
  const manual=acquireChatLease(p.id);scheduleRefreshJobs(at);
  assert.equal(claimRefreshJob(),null);releaseChatLease(p.id,manual);
  const job=claimRefreshJob()!;assert.ok(job);assertRefreshCurrent(job);
  const lease=acquireChatLease(p.id,undefined,job.lease_token!);
  assertPlaylistLease(p.id,lease);assert.throws(()=>acquireChatLease(p.id),/already being updated/);
  updatePlaylist(p.id,{intent:'Changed while running'});
  assert.throws(()=>assertRefreshCurrent(job),/superseded/);
  finishRefreshJob(job,{},'Playlist settings changed; refresh superseded');releaseChatLease(p.id,lease);
  assert.equal(scheduleRefreshJobs(at),1);
  const replacement=claimRefreshJob()!;assert.notEqual(replacement.revision,job.revision);
});
for(const status of ['queued','running'] as const)test(`a new manual request after a config edit cannot join an obsolete ${status} job`,()=>{
  const oldId=requestPlaylistRefresh(p.id,1,'old-settings-'+status);
  const running=status==='running'?claimRefreshJob()!:null;
  if(running)acquireChatLease(p.id,undefined,running.lease_token!);
  updatePlaylist(p.id,{intent:'Latest requested settings '+status});
  const freshId=requestPlaylistRefresh(p.id,1,'new-settings-'+status);
  assert.notEqual(freshId,oldId);
  assert.equal(requestPlaylistRefresh(p.id,1,'join-new-settings-'+status),freshId,'Repeated requests join the current revision even when its timestamp ties the old job');
  const old=database.prepare('SELECT status,lease_token FROM playlist_refresh_jobs WHERE id=?').get(oldId) as {status:string;lease_token:string|null};
  assert.equal(old.status,running?'running':'superseded');
  if(running){
    assert.equal(old.lease_token,running.lease_token);assert.equal(claimRefreshJob(),null,'A new request cannot take over an unfinished publication lease');
    assert.throws(()=>assertRefreshCurrent(running),/superseded/);
    finishRefreshJob(running,{},'Playlist settings changed; refresh superseded');releaseChatLease(p.id,running.lease_token!);
  }
  assert.equal(claimRefreshJob()?.id,freshId);
});
test('old retries are superseded instead of replaying every missed date',()=>{
  scheduleRefreshJobs(at);const job=claimRefreshJob(at.getTime())!;finishRefreshJob(job,{},'Offline',at.getTime());
  scheduleRefreshJobs(new Date('2026-10-28T12:00:00Z'));
  const live=database.prepare("SELECT scheduled_date FROM playlist_refresh_jobs WHERE status='queued'").all() as Array<{scheduled_date:string}>;
  assert.deepEqual(live,[{scheduled_date:'2026-10-28'}]);
});
test('changing rollout mode cannot execute queued jobs outside the current canary',()=>{
  updatePlaylist(other.id,{enabled:true});
  try{
    scheduleRefreshJobs(at);stateSet('playlist_refresh_mode','canary');stateSet('playlist_refresh_canary_ids',String(other.id));
    assert.equal(claimRefreshJob(at.getTime())?.playlist_id,other.id);
    assert.equal(claimRefreshJob(at.getTime()),null,'The other queued playlist must remain outside the canary');
    stateSet('playlist_refresh_mode','shadow');assert.equal(claimRefreshJob(at.getTime()),null,'Shadow mode cannot publish an older nightly job');
    stateSet('playlist_refresh_mode','off');assert.equal(claimRefreshJob(at.getTime()),null);
  }finally{updatePlaylist(other.id,{enabled:false})}
});
test.after(()=>{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
