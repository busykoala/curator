import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('unconfirmed approvals retry only after fresh client/history absence checks',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'curator-submissions-'));process.env.DATABASE_PATH=join(dir,'db.sqlite');
  const {db}=await import('@/features/db/client'),{upsertTarget,targetByAlbum}=await import('./repository'),{reconcileSubmissions}=await import('./submissions');
  const fetch=globalThis.fetch;let offline=false,transferComplete=false;
  globalThis.fetch=async(input)=>{
    const url=String(input);
    if(offline)throw Error('Service unavailable');
    if(url.includes('/auth/login'))return new Response('Ok.',{headers:{'set-cookie':'SID=test'}});
    if(url.includes('/torrents/info'))return Response.json([{hash:'a'.repeat(40),name:'Existing',progress:.5,added_on:0},{hash:'c'.repeat(40),name:'Different Album',progress:transferComplete?1:.5,added_on:0}]);
    if(url.includes('/history/since?'))return Response.json([]);
    throw Error('Unexpected call');
  };
  try{
    for(const id of [1,2,3]){upsertTarget({albumId:id,origin:'user',artist:'Artist',title:'Album '+id});db().prepare("INSERT INTO acquisition_submissions(target_id,guid,status,detail_json,created_at) VALUES(?,?,'accepted',?,datetime('now','-30 minutes'))").run(targetByAlbum(id)!.id,'source-'+id,JSON.stringify({title:'Album '+id,source:'Indexer',hash:(id===1?'a':'b').repeat(40)}))}
    await reconcileSubmissions([]);
    assert.ok(db().prepare('SELECT 1 FROM acquisition_submissions WHERE target_id=?').get(targetByAlbum(1)!.id));
    assert.equal(db().prepare('SELECT 1 FROM acquisition_submissions WHERE target_id=?').get(targetByAlbum(2)!.id),undefined);
    assert.equal(targetByAlbum(2)!.status,'pending');
    assert.equal((db().prepare("SELECT count(*) n FROM source_outcomes WHERE event='submission_failure'").get() as {n:number}).n,2);
    db().prepare("INSERT INTO acquisition_submissions(target_id,guid,status,detail_json,created_at) VALUES(?,'offline','accepted','{}',datetime('now','-30 minutes'))").run(targetByAlbum(3)!.id);
    offline=true;await assert.rejects(reconcileSubmissions([]),/unavailable/);
    assert.ok(db().prepare('SELECT 1 FROM acquisition_submissions WHERE target_id=?').get(targetByAlbum(3)!.id));
    offline=false;
    for(const id of [4,5]){upsertTarget({albumId:id,origin:'user',artist:'Artist',title:'Album '+id});db().prepare("INSERT INTO acquisition_submissions(target_id,guid,status,detail_json,created_at) VALUES(?,?,'accepted',?,datetime('now','-30 minutes'))").run(targetByAlbum(id)!.id,'source-'+id,JSON.stringify({title:'Album '+id,source:'Indexer',hash:(id===4?'c':'d').repeat(40)}))}
    const queue=[{id:104,albumId:99,downloadId:'c'.repeat(40)},{id:105,albumId:5,downloadId:'d'.repeat(40)}];
    await reconcileSubmissions(queue);
    assert.ok(db().prepare('SELECT 1 FROM acquisition_submissions WHERE target_id=?').get(targetByAlbum(4)!.id),'An in-flight transfer is retained even if native tracking differs');
    transferComplete=true;await reconcileSubmissions(queue);
    assert.equal(db().prepare('SELECT 1 FROM acquisition_submissions WHERE target_id=?').get(targetByAlbum(4)!.id),undefined);
    assert.ok(db().prepare('SELECT 1 FROM acquisition_submissions WHERE target_id=?').get(targetByAlbum(5)!.id),'Correct owner-album tracking remains authoritative');
    const mismatch=db().prepare("SELECT detail_json FROM source_outcomes WHERE event='submission_mismatch'").get() as {detail_json:string};
    assert.equal(JSON.parse(mismatch.detail_json).albumId,4);
    assert.deepEqual(JSON.parse(mismatch.detail_json).trackedAlbumIds,[99]);
    assert.equal((db().prepare("SELECT count(*) n FROM source_outcomes WHERE event='submission_failure' AND json_extract(detail_json,'$.guid')='source-4'").get() as {n:number}).n,0,'A valid studio payload is not globally marked failed because a collection requested it');
  }finally{globalThis.fetch=fetch;db().close();rmSync(dir,{recursive:true,force:true})}
});
