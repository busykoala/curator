import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db,stateGet} from '@/features/db/client';
import {cachedDiscoveryRequest,discoveryJson,reserveDiscoveryRequest} from './discovery-sources';

const directory=mkdtempSync(join(tmpdir(),'curator-discovery-sources-'));config.DATABASE_PATH=join(directory,'test.sqlite');const database=db();
test.beforeEach(()=>database.exec('DELETE FROM playlist_source_requests;DELETE FROM playlist_source_cache;DELETE FROM state'));
test('cache hits consume no provider requests and preserve their original fetch timestamp',async()=>{
  let calls=0;const load=async()=>({items:[++calls]});
  const first=await cachedDiscoveryRequest('fixture','query','api',7,load),second=await cachedDiscoveryRequest('fixture','query','api',7,load);
  assert.equal(calls,1);assert.equal(second.cached,true);assert.equal(first.fetchedAt,second.fetchedAt);
  assert.equal((database.prepare('SELECT count(*) n FROM playlist_source_requests').get() as {n:number}).n,1);
});
test('global, editorial and search limits reject excess requests without resetting quotas',()=>{
  for(let i=0;i<20;i++)reserveDiscoveryRequest('editorial','editorial');
  assert.throws(()=>reserveDiscoveryRequest('editorial','editorial'),/budget/);
  for(let i=0;i<5;i++)reserveDiscoveryRequest('search','search');
  assert.throws(()=>reserveDiscoveryRequest('search','search'),/budget/);
  for(let i=0;i<75;i++)reserveDiscoveryRequest('api','api');
  assert.throws(()=>reserveDiscoveryRequest('other','identity'),/budget/);
  assert.equal((database.prepare('SELECT count(*) n FROM playlist_source_requests').get() as {n:number}).n,100);
});
test('Retry-After is persisted and one provider cooldown does not suppress another',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response('Rate limited',{status:429,headers:{'retry-after':'120'}})};
  try{
    await assert.rejects(discoveryJson('limited','https://example.com/api'),/429/);
    assert.ok(Number(stateGet('playlist_source_cooldown:limited'))>=Date.now()+110000);
    assert.throws(()=>reserveDiscoveryRequest('limited','api'),/cooling/);
    assert.ok(reserveDiscoveryRequest('independent','api'));assert.equal(calls,1);
  }finally{globalThis.fetch=original}
});
test('an empty successful provider result is distinct from an unavailable provider',async()=>{
  await cachedDiscoveryRequest('empty','q','api',7,async()=>[]);
  await assert.rejects(cachedDiscoveryRequest('broken','q','api',7,async()=>{throw Error('Unavailable')}),/Unavailable/);
  const rows=database.prepare('SELECT provider,status FROM playlist_source_requests ORDER BY id').all();
  assert.deepEqual(rows,[{provider:'empty',status:'success'},{provider:'broken',status:'failed'}]);
  assert.equal(stateGet('playlist_source_error:empty'),'');assert.match(stateGet('playlist_source_error:broken'),/Unavailable/);
});
test('malformed provider data is not cached as success and does not suppress another source',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({error:'Wrong schema'});
  try{
    await assert.rejects(discoveryJson('malformed','https://example.com/api',7,'api',undefined,raw=>{
      if(!Array.isArray(raw))throw Error('Malformed recommendation response');return raw;
    }),/Malformed recommendation/);
    assert.equal((database.prepare('SELECT count(*) n FROM playlist_source_cache').get() as {n:number}).n,0);
    assert.equal((database.prepare('SELECT status FROM playlist_source_requests').get() as {status:string}).status,'failed');
    assert.ok(Number(stateGet('playlist_source_cooldown:malformed'))>Date.now());assert.ok(reserveDiscoveryRequest('healthy','api'));
  }finally{globalThis.fetch=original}
});
test.after(()=>{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
