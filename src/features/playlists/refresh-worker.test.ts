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
import {StalePlaylistProposalError} from './proposal-errors';
import {publicationHash} from './refresh-policy';

const directory=mkdtempSync(join(tmpdir(),'curator-refresh-runner-'));config.DATABASE_PATH=join(directory,'test.sqlite');
const database=db();database.exec("INSERT INTO curator_users(id,navidrome_user_id,username,display_name) VALUES(1,'one','one','One')");
const p=createPlaylist({name:'Test',category:'mood',enabled:true,ownerUserId:1,config:{targetTracks:2}});
database.exec("UPDATE smart_playlists SET created_at='2026-01-01 00:00:00'");
test.beforeEach(()=>{database.exec('DELETE FROM playlist_refresh_jobs;DELETE FROM playlist_publications');stateSet('playlist_refresh_mode','enabled')});
for(const id of [1,2])database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES(?,?,'album','Artist','Album','flac',?,1,1,1,'{}','{}','{}','written')").run(id,'/music/'+id,id);
function proposal(){
  const row=database.prepare("INSERT INTO playlist_runs(playlist_id,status,preview,config_hash,detail_json) VALUES (?,'complete',1,'test','{\"tracks\":2}') RETURNING id").get(p.id) as {id:number};
  for(const id of [1,2])database.prepare("INSERT INTO playlist_items(run_id,playlist_id,file_id,navidrome_song_id,position,score,origin,reason) VALUES(?,?,?,?,?,1,'catalog','Fixture')").run(row.id,p.id,id,'native-'+id,id-1);
  return row;
}

test('a failed publication retries the persisted proposal rather than regenerating it',async()=>{
  scheduleRefreshJobs();let generations=0,publications=0;
  const run=database.prepare("INSERT INTO playlist_runs(playlist_id,status,preview,config_hash,detail_json) VALUES (?,'complete',1,'test','{\"tracks\":2}') RETURNING id").get(p.id) as {id:number};
  const deps={generate:async(...args:unknown[])=>{assert.equal(args[4],'background');generations++;return{runId:run.id,definition:getPlaylist(p.id)!,items:[],detail:{tracks:2,retained:0,pending:0,navidromeId:null}}},
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
  const deps={generate:async(...args:unknown[])=>{assert.equal(args[4],'shadow');return{runId:run.id,definition:getPlaylist(p.id)!,items:[],detail:{tracks:2,retained:0,pending:0,navidromeId:null}}},publish:async()=>{throw Error('Shadow must not publish')}};
  await runNextRefreshJob(deps);
  const result=database.prepare('SELECT status,result_json FROM playlist_refresh_jobs').get() as {status:string;result_json:string};
  assert.equal(result.status,'completed');assert.equal(JSON.parse(result.result_json).unpublished,true);
});
test('an invalidated proposal with no native attempt is regenerated on retry while its failure remains visible',async()=>{
  scheduleRefreshJobs();let generations=0,publications=0,first=0;
  const deps={generate:async()=>{const run=proposal();generations++;if(!first)first=run.id;return{runId:run.id,definition:getPlaylist(p.id)!,items:[],detail:{tracks:2,retained:0,pending:0,navidromeId:null}}},
    publish:async(_id:number,runId:number)=>{publications++;if(publications===1)throw new StalePlaylistProposalError('Track evidence or availability changed; kept the previous mix');assert.notEqual(runId,first);return{definition:getPlaylist(p.id)!,items:[{} as never,{} as never],detail:{tracks:2,navidromeId:'native'}}}};
  await runNextRefreshJob(deps);
  const retry=database.prepare('SELECT phase,run_id,error FROM playlist_refresh_jobs').get() as {phase:string;run_id:number;error:string};
  assert.equal(retry.phase,'generate');assert.equal(retry.run_id,first);assert.match(retry.error,/evidence/);
  database.exec('UPDATE playlist_refresh_jobs SET next_attempt_at=0');await runNextRefreshJob(deps);
  assert.equal(generations,2);assert.equal(publications,2);assert.equal((database.prepare('SELECT status FROM playlist_refresh_jobs').get() as {status:string}).status,'completed');
});
for(const status of ['uncertain','verified'])test(`an existing ${status} native checkpoint is never discarded for regeneration`,async()=>{
  scheduleRefreshJobs();const run=proposal();let generations=0,publications=0;
  database.prepare("INSERT INTO playlist_publications(id,playlist_id,owner_user_id,revision,selection_hash,song_ids_json,native_id,status) VALUES(?,?,1,?,?,?,'native',?)")
    .run('journal-'+status,p.id,getPlaylist(p.id)!.revision,publicationHash(['native-1','native-2']),JSON.stringify(['native-1','native-2']),status);
  const deps={generate:async()=>{generations++;return{runId:run.id,definition:getPlaylist(p.id)!,items:[],detail:{tracks:2,retained:0,pending:0,navidromeId:null}}},publish:async()=>{publications++;throw new StalePlaylistProposalError('Track evidence or availability changed; kept the previous mix')}};
  await runNextRefreshJob(deps);assert.equal((database.prepare('SELECT phase FROM playlist_refresh_jobs').get() as {phase:string}).phase,'publish');
  database.exec('UPDATE playlist_refresh_jobs SET next_attempt_at=0');await runNextRefreshJob(deps);
  assert.equal(generations,1);assert.equal(publications,2);assert.equal((database.prepare('SELECT run_id FROM playlist_refresh_jobs').get() as {run_id:number}).run_id,run.id);
});
test.after(()=>{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
