import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('unconfirmed approvals retry only after fresh client/history absence checks',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'curator-submissions-'));process.env.DATABASE_PATH=join(dir,'db.sqlite');
  const {db}=await import('@/features/db/client'),{upsertTarget,targetByAlbum}=await import('./repository'),{reconcileSubmissions}=await import('./submissions');
  const fetch=globalThis.fetch;let offline=false;
  globalThis.fetch=async(input)=>{
    const url=String(input);
    if(offline)throw Error('Service unavailable');
    if(url.includes('/auth/login'))return new Response('Ok.',{headers:{'set-cookie':'SID=test'}});
    if(url.includes('/torrents/info'))return Response.json([{hash:'a'.repeat(40),name:'Existing',progress:.5,added_on:0}]);
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
  }finally{globalThis.fetch=fetch;db().close();rmSync(dir,{recursive:true,force:true})}
});
