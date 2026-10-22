import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {config} from '@/config';import {db,stateSet} from '@/features/db/client';
import {runSharedInference} from './scheduler';
import {CuratorAiClient} from './client';
const directory=mkdtempSync(join(tmpdir(),'curator-ai-scheduler-'));config.DATABASE_PATH=join(directory,'db.sqlite');const database=db();
test.beforeEach(()=>{stateSet('playlist_refresh_mode','enabled');database.exec('DELETE FROM playlist_inference_queue;DELETE FROM playlist_inference_slot')});
test('only one background generation holds the shared slot at a time',async()=>{
  let active=0,maxActive=0;const run=()=>runSharedInference(async()=>{active++;maxActive=Math.max(maxActive,active);await delay(20);active--;return true},AbortSignal.timeout(2000),'background');
  assert.deepEqual(await Promise.all([run(),run(),run()]),[true,true,true]);assert.equal(maxActive,1);
});
test('interactive work preempts a background request and runs before queued background work',async()=>{
  const order:string[]=[];
  let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve});
  const background=runSharedInference(async signal=>{order.push('background-start');started();await delay(5000,undefined,{signal})},AbortSignal.timeout(3000),'background');
  const rejected=assert.rejects(background,/aborted|interactive/i);await ready;
  const waiting=runSharedInference(async()=>{order.push('queued-background')},AbortSignal.timeout(3000),'background');
  const interactive=runSharedInference(async()=>{order.push('interactive')},AbortSignal.timeout(3000),'interactive');
  await Promise.all([rejected,waiting,interactive]);assert.deepEqual(order,['background-start','interactive','queued-background']);
});
test('expired leases recover, cancelled waiters leave no queue entry, and rollout off bypasses the gate',async()=>{
  database.prepare("INSERT INTO playlist_inference_slot(id,lease_token,lease_until) VALUES(1,'crashed',?)").run(Date.now()-1);
  assert.equal(await runSharedInference(async()=>42,AbortSignal.timeout(1000),'background'),42);
  database.prepare("UPDATE playlist_inference_slot SET lease_token='busy',lease_until=? WHERE id=1").run(Date.now()+3000);
  await assert.rejects(runSharedInference(async()=>{throw Error('Should not acquire')},AbortSignal.timeout(20),'background'),/aborted/i);
  assert.equal((database.prepare('SELECT count(*) n FROM playlist_inference_queue').get() as {n:number}).n,0);
  stateSet('playlist_refresh_mode','off');assert.equal(await runSharedInference(async()=>7,AbortSignal.timeout(1000),'background'),7);
});
test('queued chat immediately yields background inference instead of waiting while holding a playlist lease',async()=>{
  database.exec("INSERT INTO curator_users(id,navidrome_user_id,username,display_name) VALUES(1,'one','one','One');INSERT INTO smart_playlists(id,name,category,owner_user_id) VALUES(1,'Chat','chat',1);INSERT INTO playlist_chat_jobs(id,playlist_id,message,target_tracks,base_revision,created_at,updated_at) VALUES('chat',1,'A request',1,0,0,0)");
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('Background should yield before HTTP')};
  try{
    const client=new CuratorAiClient({baseURL:'http://local/v1',model:'curator',apiKey:'test',runCompletion:runSharedInference}),started=Date.now();
    await assert.rejects(client.structured({input:'Refresh',schemaName:'test',schema:{type:'object'},deadlineMs:1000}),/yielded to interactive/);
    assert.equal(calls,0);assert.ok(Date.now()-started<500);
  }finally{globalThis.fetch=original}
});
test.after(()=>{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
