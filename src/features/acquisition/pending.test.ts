import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {upsertTarget,targetByAlbum,updateTarget} from './repository';
import {blockedNativePending,retryBlockedPending} from './pending';
import type {QueueItem} from './lidarr';
const dir=mkdtempSync(join(tmpdir(),'curator-native-pending-'));config.DATABASE_PATH=join(dir,'db.sqlite');
after(()=>{db().close();rmSync(dir,{recursive:true,force:true})});
test('native HTTP cooldown decisions retry without deleting data, blocklisting, or disturbing active and intentional waits',async()=>{
 upsertTarget({albumId:1,origin:'migration',artist:'Artist',title:'Album'});
 const id=targetByAlbum(1)!.id;
 const detail_json=JSON.stringify({rejections:{'Indexer Knaben (Prowlarr) is blocked till 10/17/2026 13:05:30 due to failures, cannot grab release.':1}});
 updateTarget(id,{status:'staged',detail_json,next_retry_at:new Date(Date.now()+3600000).toISOString()});
 const target=targetByAlbum(1)!,item:QueueItem={id:123,albumId:1,status:'delay',added:new Date(Date.now()-3600000).toISOString()};
 assert.equal(blockedNativePending(item,target),true);
 for(const change of [{downloadId:'actual-torrent'}, {status:'downloading'}, {added:new Date().toISOString()}, {added:'invalid'}])assert.equal(blockedNativePending({...item,...change},target),false);
 for(const detail_json of ['{',JSON.stringify({rejections:{'Waiting for better quality release':1}}),JSON.stringify({rejections:{'Indexer is unavailable':1}})])assert.equal(blockedNativePending(item,{...target,detail_json}),false);
 assert.equal(blockedNativePending(item,{...target,status:'downloading'}),false);
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(input,init)=>{const u=new URL(String(input));calls++;assert.equal(u.pathname,'/api/v1/queue/123');assert.equal(init?.method,'DELETE');for(const key of ['removeFromClient','blocklist','changeCategory'])assert.equal(u.searchParams.get(key),'false');assert.equal(u.searchParams.get('skipRedownload'),'true');return new Response(null,{status:204})};
 try{
  assert.deepEqual(await retryBlockedPending([item],new Set([1]),false),[item]);assert.equal(calls,0);
  assert.deepEqual(await retryBlockedPending([item],new Set(),true),[item]);assert.equal(calls,0);
  assert.deepEqual(await retryBlockedPending([item],new Set([1]),true),[]);assert.equal(calls,1);
  assert.equal(targetByAlbum(1)!.status,'pending');assert.equal(targetByAlbum(1)!.next_retry_at,null);
  assert.equal(JSON.parse(targetByAlbum(1)!.detail_json!).recoveryRetry,true);
 }finally{globalThis.fetch=original}
});
