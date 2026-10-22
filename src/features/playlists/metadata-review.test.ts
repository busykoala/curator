import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {config} from '@/config';import {db,stateGet} from '@/features/db/client';
import {recordingFacts,queueMetadataReview,runMetadataReviews,seedMetadataReviews,type ReviewIdentity} from './metadata-review';
const directory=mkdtempSync(join(tmpdir(),'curator-metadata-review-'));config.DATABASE_PATH=join(directory,'db.sqlite');const database=db();
const id='a74b1b7f-71a5-4011-9441-d0b5e4122711';
const identity:ReviewIdentity={fileId:1,artist:'Artist',title:'Song',durationMs:180000,tags:{artist:['Artist']},recordingId:id};
test('recording credits bind by identity, title, artist and duration; absent vocals do not prove an instrumental',()=>{
  const recording={id,title:'Song',length:180500,'artist-credit':[{artist:{id:'artist',name:'Artist'}}],relations:[{type:'instrument',attributes:['piano']}]};
  const facts=recordingFacts(identity,recording);assert.ok(facts.some(f=>f.field==='instrumentation'));assert.ok(!facts.some(f=>f.field==='vocalPresence'));
  assert.deepEqual(recordingFacts(identity,{...recording,length:240000}),[]);assert.deepEqual(recordingFacts(identity,{...recording,title:'Another song'}),[]);
});
function file(n:number){database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES(?,?,'a','Artist','Album','flac',?,1,1,1,?,?,'{}','written')").run(n,'/music/'+n,n,JSON.stringify({title:['Song'],artist:['Artist'],musicbrainz_recordingid:[id]}),JSON.stringify({durationMs:180000}))}
test('review seeds active selections and new IDs without reclassifying the existing library',()=>{
  for(let n=1;n<=120;n++)file(n);
  assert.equal(seedMetadataReviews(),0);file(121);assert.equal(seedMetadataReviews(),1);
  assert.deepEqual(database.prepare('SELECT file_id FROM playlist_metadata_reviews').all(),[{file_id:121}]);
});
test('review respects the daily 100-track cap and interactive chat priority',async()=>{
  database.exec('DELETE FROM playlist_metadata_reviews');for(let n=1;n<=110;n++)queueMetadataReview(n,'fixture',n);
  let calls=0;await runMetadataReviews(async()=>{calls++;return[{field:'recordingId',value:id,scope:'recording',url:'https://musicbrainz.org/recording/'+id}]},100);
  assert.equal(calls,100);assert.equal(await runMetadataReviews(async()=>{throw Error('Cap violated')},100),0);
  const row=database.prepare("SELECT facts_json FROM playlist_metadata_reviews WHERE file_id=110").get() as {facts_json:string};assert.ok(JSON.parse(row.facts_json).length);
  database.exec("DELETE FROM playlist_metadata_review_attempts;INSERT INTO curator_users(id,navidrome_user_id,username,display_name) VALUES(1,'one','one','One');INSERT INTO smart_playlists(id,name,category,owner_user_id) VALUES(1,'Chat','chat',1);INSERT INTO playlist_chat_jobs(id,playlist_id,message,target_tracks,base_revision,created_at,updated_at) VALUES('chat',1,'A request',1,0,0,0)");
  assert.equal(await runMetadataReviews(async()=>{throw Error('Should yield')},1),0);
});
test('identity changes invalidate cached review facts and retry dates',()=>{
  database.prepare("UPDATE playlist_metadata_reviews SET status='complete',facts_json='[{\"old\":true}]',next_retry_at=9999999999999 WHERE file_id=110").run();
  database.prepare("UPDATE files SET tags_json=? WHERE id=110").run(JSON.stringify({title:['Another song']}));
  queueMetadataReview(110,'Identity changed');
  assert.deepEqual(database.prepare('SELECT status,facts_json,next_retry_at FROM playlist_metadata_reviews WHERE file_id=110').get(),{status:'queued',facts_json:'[]',next_retry_at:0});
});
test('priority ordering does not advance the import watermark past unqueued songs',()=>{
  for(let n=122;n<=240;n++)file(n);
  database.prepare("INSERT INTO playlist_runs(id,playlist_id,owner_user_id,status,preview,config_hash) VALUES(1,1,1,'complete',0,'fixture')").run();
  database.prepare("INSERT INTO playlist_items(run_id,playlist_id,file_id,position,score,origin,reason) VALUES(1,1,240,0,1,'catalog','Fixture')").run();
  assert.equal(seedMetadataReviews(),100);
  assert.ok(Number(stateGet('playlist_metadata_file_watermark','0'))<239);
  seedMetadataReviews();
  assert.ok(database.prepare('SELECT 1 FROM playlist_metadata_reviews WHERE file_id=239').get());
});
test.after(()=>{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
