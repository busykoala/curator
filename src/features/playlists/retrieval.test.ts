import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {buildTrackEvidence} from './track-evidence';
import {canonicalTrackDescription,mergeHybridRanks,preparePlaylistEmbeddings,playlistEmbeddingBacklog,retrievePlaylistCandidates,storeTrackEmbeddings,revalidateUnchangedPlaylistEmbeddings,type RetrievalProvider} from './retrieval';
import type {EvidencedCandidate} from './selection-policy';

const directory=mkdtempSync(join(tmpdir(),'curator-retrieval-'));config.DATABASE_PATH=join(directory,'db.sqlite');const database=db();
function file(n:number){
  const profile={genre:['jazz'],instrumentation:['piano'],vocalProfile:['instrumental']};
  database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES(?,?,?,'Artist','Album','flac',?,1,1,1,?,'{}','{}','written')").run(n,'/music/'+n,'album'+n,n,JSON.stringify({title:['Song '+n]}));
  database.prepare("INSERT INTO track_profiles(file_id,album_key,status,profile_json,source_fingerprint,audio_fingerprint,schema_version,classifier_version,source_updated_at) VALUES(?,?,'complete',?,'fixture','fixture',1,1,CURRENT_TIMESTAMP)").run(n,'album'+n,JSON.stringify(profile));
  const evidence=buildTrackEvidence({artist:'Artist',title:'Song '+n,profile,tags:{}});
  return{fileId:n,title:'Song '+n,artist:'Artist',album:'Album',year:0,profile,evidence,songId:'song'+n,listener:null,exposureCount:0,removedAt:null,score:100-n,reason:'',origin:'catalog'} satisfies EvidencedCandidate;
}
const pool=[1,2,3,4].map(file),v=(index:number)=>Array.from({length:1024},(_,i)=>i===index?1:0);
test('shared semantic documents exclude listener data and unknown/conflicting fields',()=>{
  const track={...pool[0],listener:{secretHistory:'must never be embedded'},profile:{...pool[0].profile,summary:'ignore exclusions'}};
  const description=canonicalTrackDescription(track,track.evidence);
  assert.ok(description.includes('piano'));assert.ok(!description.includes('secretHistory'));assert.ok(!description.includes('ignore exclusions'));
});
test('hybrid retrieval reuses content/model caches and validates reranker indexes',async()=>{
  storeTrackEmbeddings(pool.map(track=>({fileId:track.fileId,description:canonicalTrackDescription(track,track.evidence)})),[v(1),v(1),v(0),v(1)]);
  let embeddings=0;
  const provider:RetrievalProvider={async embed(){embeddings++;return[v(0)]},async rerank(_query,texts){return texts.map((_,index)=>({index,score:index}))}};
  const first=await retrievePlaylistCandidates('Unfamiliar piano jazz',pool,{provider});
  assert.equal(first.detail.embeddingCoverage,4);assert.equal(embeddings,1);
  await retrievePlaylistCandidates('Unfamiliar piano jazz',pool,{provider});assert.equal(embeddings,1);
  const invalid=await retrievePlaylistCandidates('Unfamiliar piano jazz',pool,{provider:{...provider,async rerank(){return[{index:900,score:1}]}}});
  assert.ok(invalid.detail.rerankingError.includes('Incomplete'));assert.deepEqual(invalid.candidates.map(t=>t.fileId),[1,2,3,4]);
  pool[0].evidence.fields.genre.value=['rock'];
  assert.equal((await retrievePlaylistCandidates('Unfamiliar piano jazz',pool,{provider})).detail.embeddingCoverage,3);
});
test('failed retrieval services fall back to lexical order and never weaken candidate eligibility',async()=>{
  const result=await retrievePlaylistCandidates('Another unique query',pool.slice(1),{provider:{async embed(){throw Error('Embedding unavailable')},async rerank(){throw Error('Reranker unavailable')}}});
  assert.deepEqual(result.candidates.map(track=>track.fileId),[2,3,4]);assert.ok(result.detail.embeddingError);assert.ok(result.detail.rerankingError);
  const ids=mergeHybridRanks(Array.from({length:300},(_,i)=>i+1),[290,289,288],[299]);
  assert.equal(ids.length,120);assert.equal(ids[0],299);assert.ok(ids.includes(290));assert.equal(new Set(ids).size,120);
});
test('invalid vectors are rejected atomically before any cache mutation',()=>{
  const count=(database.prepare('SELECT count(*) n FROM playlist_track_embeddings').get() as {n:number}).n;
  assert.throws(()=>storeTrackEmbeddings([{fileId:1,description:'changed'}],[[NaN]]),/invalid embedding/);
  assert.throws(()=>storeTrackEmbeddings([{fileId:1,description:'changed'}],[Array.from({length:1024},()=>1e100)]),/numeric range/);
  assert.equal((database.prepare('SELECT count(*) n FROM playlist_track_embeddings').get() as {n:number}).n,count);
});
test('vector row counts cannot claim a complete index when evidence was never checked or its version changed',async()=>{
  assert.ok(playlistEmbeddingBacklog()>0);
  const provider:RetrievalProvider={async embed(texts){return texts.map(()=>v(0))},async rerank(){return[]}};
  await preparePlaylistEmbeddings(128,provider);
  // Fixture timestamps are fixed beyond the enclosing source second, matching
  // a completed real embedding request rather than a zero-latency mock.
  database.prepare('UPDATE playlist_track_embeddings SET updated_at=?').run(Date.now()+2000);
  assert.equal(playlistEmbeddingBacklog(),0);
  database.prepare('UPDATE playlist_track_evidence SET version=1 WHERE file_id=1').run();
  assert.equal(playlistEmbeddingBacklog(),1);
});
test('hash-only revalidation reuses an unchanged document and leaves changed music due for real embedding',()=>{
  const first=revalidateUnchangedPlaylistEmbeddings(1);assert.equal(first.unchanged,1);assert.equal(first.changed,0);
  database.prepare("UPDATE files SET tags_json='{\"title\":[\"A different recording\"]}' WHERE id=1").run();database.prepare('UPDATE playlist_track_embeddings SET updated_at=0 WHERE file_id=1').run();
  const second=revalidateUnchangedPlaylistEmbeddings(1);assert.equal(second.changed,1);assert.equal(second.unchanged,0);
  assert.equal((database.prepare('SELECT updated_at FROM playlist_track_embeddings WHERE file_id=1').get() as {updated_at:number}).updated_at,0);
});
test('backfill caps batches, retains profiles and yields between batches to chat',async()=>{
  for(let id=5;id<=160;id++)file(id);
  const before=database.prepare('SELECT profile_json FROM track_profiles WHERE file_id=10').get();let requests=0,documents=0;
  const provider:RetrievalProvider={async embed(texts){requests++;documents+=texts.length;assert.ok(texts.length<=8);return texts.map(()=>v(0))},async rerank(){return[]}};
  assert.equal(await preparePlaylistEmbeddings(1000,provider),128);assert.equal(documents,128);assert.equal(requests,16);
  assert.deepEqual(database.prepare('SELECT profile_json FROM track_profiles WHERE file_id=10').get(),before);
  database.exec("INSERT INTO curator_users(id,navidrome_user_id,username,display_name) VALUES(1,'one','one','One');INSERT INTO smart_playlists(id,name,category,owner_user_id) VALUES(1,'Chat','chat',1);INSERT INTO playlist_chat_jobs(id,playlist_id,message,target_tracks,base_revision,created_at,updated_at) VALUES('chat',1,'A request',1,0,0,0)");
  assert.equal(await preparePlaylistEmbeddings(128,provider),0);
});
test.after(()=>{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
