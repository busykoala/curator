import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import Database from 'better-sqlite3';
import {config} from '@/config';
import {db} from '@/features/db/client';
const directory=mkdtempSync(join(tmpdir(),'curator-night-observer-')),path=join(directory,'test.sqlite');config.DATABASE_PATH=path;
const database=db();
database.exec(`INSERT INTO curator_users(id,navidrome_user_id,username,display_name) VALUES(1,'one','one','One');
  INSERT INTO state(key,value) VALUES('playlist_refresh_mode','shadow');
  INSERT INTO smart_playlists(id,name,category,owner_user_id,enabled,created_at,config_json) VALUES(1,'Night check','mood',1,1,'2026-10-01 00:00:00','{"targetTracks":2}');
  INSERT INTO playlist_runs(id,playlist_id,owner_user_id,config_hash,status,preview,source_kind,finished_at,detail_json) VALUES(1,1,1,'test','complete',1,'shadow','2026-10-22 02:40:00','{"selectionVersion":1,"evaluation":{"requested":2,"violations":[],"shortage":0}}');
  INSERT INTO playlist_refresh_jobs(id,playlist_id,owner_user_id,scheduled_date,kind,revision,mode,status,run_id,result_json,created_at,updated_at) VALUES('job',1,1,'2026-10-22','shadow',1,'shadow','completed',1,'{"unpublished":true}',0,0);`);
for(let id=1;id<=2;id++){
  database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES(?,?,'album','Artist','Album','flac',?,1,1,1,?,'{}','{}','written')").run(id,'/music/'+id,id,JSON.stringify({title:['Song '+id]}));
  database.prepare("INSERT INTO playlist_items(run_id,playlist_id,file_id,navidrome_song_id,position,score,origin,reason) VALUES(1,1,?,?,?,1,'catalog','Fixture')").run(id,'native-'+id,id-1);
}
database.pragma('wal_checkpoint(TRUNCATE)');database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;
const hash=()=>createHash('sha256').update(readFileSync(path)).digest('hex');
async function observe(){
  const before=hash(),result=await promisify(execFile)(process.execPath,['--import','tsx','scripts/observe-playlist-night.ts'],{cwd:process.cwd(),env:{...process.env,CURATOR_DB_PATH:path,PLAYLIST_OBSERVER_DATE:'2026-10-22',PLAYLIST_OBSERVER_KIND:'shadow',PLAYLIST_OBSERVER_OUTPUT:join(directory,'reports')}});
  assert.equal(hash(),before,'The observer must not mutate the application database');
  return JSON.parse(readFileSync(JSON.parse(result.stdout).path,'utf8'));
}
test('the read-only night observer recognises a complete unpublished comparison and detects accidental publication and budget violations',async()=>{
  const healthy=await observe();assert.equal(healthy.summary.allPassed,true);assert.equal(healthy.summary.enabledInScope,1);
  const fixture=new Database(path);fixture.exec("INSERT INTO playlist_runs(playlist_id,owner_user_id,config_hash,status,preview,source_preview_id) VALUES(1,1,'test','complete',0,1)");fixture.close();
  const published=await observe();assert.equal(published.summary.allPassed,false);assert.ok(published.results[0].violations.includes('A shadow comparison was published'));
  const budget=new Database(path);budget.prepare('DELETE FROM playlist_runs WHERE preview=0').run();const insert=budget.prepare("INSERT INTO playlist_source_requests(provider,kind,created_at) VALUES('fixture','api',?)");for(let n=0;n<101;n++)insert.run(Date.now());budget.close();
  const exceeded=await observe();assert.equal(exceeded.summary.allPassed,false);assert.ok(exceeded.budgetViolations.includes('Discovery source budget exceeded'));
});
test.after(()=>rmSync(directory,{recursive:true,force:true}));
