import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db,stateSet} from '@/features/db/client';
import {createPlaylist,getPlaylist} from './repository';
import {scheduleRefreshJobs} from './refresh-jobs';
import {runNextRefreshJob} from './refresh-worker';

const directory=mkdtempSync(join(tmpdir(),'curator-refresh-runner-'));config.DATABASE_PATH=join(directory,'test.sqlite');
const database=db();database.exec("INSERT INTO curator_users(id,navidrome_user_id,username,display_name) VALUES(1,'one','one','One')");
const p=createPlaylist({name:'Test',category:'mood',enabled:true,ownerUserId:1,config:{targetTracks:2}});
database.exec("UPDATE smart_playlists SET created_at='2026-01-01 00:00:00'");
test.beforeEach(()=>{database.exec('DELETE FROM playlist_refresh_jobs');stateSet('playlist_refresh_mode','enabled')});

test('a failed publication retries the persisted proposal rather than regenerating it',async()=>{
  scheduleRefreshJobs();let generations=0,publications=0;
  const run=database.prepare("INSERT INTO playlist_runs(playlist_id,status,preview,config_hash,detail_json) VALUES (?,'complete',1,'test','{\"tracks\":2}') RETURNING id").get(p.id) as {id:number};
  const deps={generate:async()=>{generations++;return{runId:run.id,definition:getPlaylist(p.id)!,items:[],detail:{tracks:2,retained:0,pending:0,navidromeId:null}}},
    publish:async(_id:number,proposal:number)=>{publications++;assert.equal(proposal,run.id);if(publications===1)throw Error('Temporary failure');return{definition:getPlaylist(p.id)!,items:[{} as never,{} as never],detail:{tracks:2,navidromeId:'native'}}}};
  await runNextRefreshJob(deps);
  const failed=database.prepare('SELECT run_id,phase,status FROM playlist_refresh_jobs').get() as {run_id:number;phase:string;status:string};
  assert.deepEqual(failed,{run_id:run.id,phase:'publish',status:'retry'});
  database.exec('UPDATE playlist_refresh_jobs SET next_attempt_at=0');
  await runNextRefreshJob(deps);assert.equal(generations,1);assert.equal(publications,2);
  assert.equal((database.prepare('SELECT status FROM playlist_refresh_jobs').get() as {status:string}).status,'completed');
});
test('shadow jobs save a complete proposal and never invoke the publisher',async()=>{
  stateSet('playlist_refresh_mode','shadow');scheduleRefreshJobs();
  const run=database.prepare("INSERT INTO playlist_runs(playlist_id,status,preview,config_hash,detail_json) VALUES (?,'complete',1,'test','{\"tracks\":2}') RETURNING id").get(p.id) as {id:number};
  const deps={generate:async()=>({runId:run.id,definition:getPlaylist(p.id)!,items:[],detail:{tracks:2,retained:0,pending:0,navidromeId:null}}),publish:async()=>{throw Error('Shadow must not publish')}};
  await runNextRefreshJob(deps);
  const result=database.prepare('SELECT status,result_json FROM playlist_refresh_jobs').get() as {status:string;result_json:string};
  assert.equal(result.status,'completed');assert.equal(JSON.parse(result.result_json).unpublished,true);
});
test.after(()=>{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
