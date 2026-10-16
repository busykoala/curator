import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {recordingTitleAliases} from './musicbrainz';
const dir=mkdtempSync(join(tmpdir(),'curator-mb-rate-'));config.DATABASE_PATH=join(dir,'test.sqlite');
after(()=>{db().close();rmSync(dir,{recursive:true,force:true})});
test('overlapping catalogue lookups are spaced and recording aliases stay bound to their recording',async()=>{
 const original=globalThis.fetch,calls:number[]=[];
 globalThis.fetch=async input=>{calls.push(Date.now());const id=new URL(String(input)).pathname.split('/').at(-1);return Response.json({id,title:'Insensatez (How Insensitive)',aliases:[],relations:[{type:'performance',work:{title:'How Insensitive'}},{type:'unrelated',work:{title:'Wrong work'}}]})};
 try{
  const stall=setTimeout(()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1300),500);
  const results=await Promise.all([1,2,3].map(i=>recordingTitleAliases(`0000000${i}-0000-0000-0000-000000000000`,'test')));
  clearTimeout(stall);
  assert.equal(calls.length,3);assert.ok(calls[1]-calls[0]>=1000);assert.ok(calls[2]-calls[1]>=1000);
  assert.deepEqual(results[0],['Insensatez (How Insensitive)','How Insensitive']);
  await recordingTitleAliases('00000001-0000-0000-0000-000000000000','test');assert.equal(calls.length,3);
 }finally{globalThis.fetch=original}
});

test('an upstream429 is not retried inside a reserved slot and creates a shared cooldown',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('Rate limited',{status:429})};
 try{
  await assert.rejects(recordingTitleAliases('00000004-0000-0000-0000-000000000000','test'),/429/);
  await assert.rejects(recordingTitleAliases('00000005-0000-0000-0000-000000000000','test'),/cooldown/);
  assert.equal(calls,1);
  const saved=db().prepare("SELECT value FROM state WHERE key='musicbrainz_cooldown_until'").get() as {value:string};
  assert.ok(Number(saved.value)>Date.now()+4*60_000);
 }finally{globalThis.fetch=original}
});
