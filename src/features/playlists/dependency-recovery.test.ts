import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {config} from '@/config';
import {db,stateSet} from '@/features/db/client';
import {createPlaylist} from './repository';
import {failedRefreshDependency,recoverPlaylistDependencies} from './dependency-recovery';
const directory=mkdtempSync(join(tmpdir(),'curator-dependency-recovery-'));config.DATABASE_PATH=join(directory,'test.sqlite');
const database=db();database.exec("INSERT INTO curator_users(id,navidrome_user_id,username,display_name) VALUES(1,'one','one','One')");
const playlist=createPlaylist({name:'Recovery',category:'mood',ownerUserId:1,enabled:true,config:{targetTracks:2}});
test('only connectivity failures trigger a recovery probe',()=>{
  for(const error of ['insufficient matching tracks','Navidrome playlist verification failed','Local AI returned invalid JSON','Local AI request failed (429)','Playlist owner must sign in to Navidrome again','Navidrome song identity remains unresolved'])assert.equal(failedRefreshDependency(error),null,error);
  assert.equal(failedRefreshDependency('Navidrome Items failed (503)'),'navidrome');assert.equal(failedRefreshDependency('Local AI request failed (503)'),'inference');assert.equal(failedRefreshDependency('TypeError: fetch failed'),'both');
});
test('an outage recovery wakes a six-hour retry promptly without clearing its failure or duplicating probes',async()=>{
  stateSet('playlist_refresh_mode','enabled');const now=Date.now();
  database.prepare("INSERT INTO playlist_refresh_jobs(id,playlist_id,owner_user_id,scheduled_date,kind,revision,mode,status,attempts,next_attempt_at,error,created_at,updated_at) VALUES('retry',?,1,'2026-10-23','nightly',?,'enabled','retry',4,?,'Navidrome Items failed (503)',?,?)").run(playlist.id,playlist.revision,now+6*3600_000,now,now);
  let calls=0,healthy=false;const probes={navidrome:async()=>{calls++;if(!healthy)throw Error('Down')},inference:async()=>{throw Error('Wrong dependency')}};
  assert.equal(await recoverPlaylistDependencies(probes,now),0);healthy=true;assert.equal(await recoverPlaylistDependencies(probes,now+60_000),0);assert.equal(calls,1);
  assert.equal(await recoverPlaylistDependencies(probes,now+5*60_000),1);assert.equal(calls,2);
  const row=database.prepare("SELECT next_attempt_at,error,attempts FROM playlist_refresh_jobs WHERE id='retry'").get();assert.deepEqual(row,{next_attempt_at:0,error:'Navidrome Items failed (503)',attempts:4});
  assert.equal(await recoverPlaylistDependencies(probes,now+10*60_000),0);
  database.prepare("UPDATE playlist_refresh_jobs SET status='auth_wait',next_attempt_at=? WHERE id='retry'").run(now+6*3600_000);
  assert.equal(await recoverPlaylistDependencies(probes,now+15*60_000),0);
});
test('disabled playlists and pipeline off do not launch probes',async()=>{
  database.exec("UPDATE playlist_refresh_jobs SET status='retry';UPDATE smart_playlists SET enabled=0");
  const probes={navidrome:async()=>{throw Error('Unexpected probe')},inference:async()=>{throw Error('Unexpected probe')}};
  assert.equal(await recoverPlaylistDependencies(probes,Date.now()+3600_000),0);stateSet('playlist_refresh_mode','off');assert.equal(await recoverPlaylistDependencies(probes,Date.now()+7200_000),0);
});
test.after(()=>{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
