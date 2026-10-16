import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {reserveSearch,SearchDeferred,releasePushPayload} from './lidarr';
const dir=mkdtempSync(join(tmpdir(),'curator-request-budget-'));config.DATABASE_PATH=join(dir,'test.sqlite');
after(()=>{db().close();rmSync(dir,{recursive:true,force:true})});
test('Prowlarr search resources are adapted to the Lidarr submission contract',()=>{
 const r=releasePushPayload({title:'Test - Album FLAC',indexerFlags:[],categories:[{id:8000}],protocol:'torrent',infoHash:'0123456789012345678901234567890123456789',magnetUrl:'magnet:?xt=urn:btih:0123456789012345678901234567890123456789',publishDate:'2026-10-16T00:00:00Z',quality:{quality:{name:'FLAC'}},direct:true});
 assert.equal(r.indexerFlags,0);assert.equal(r.categories,undefined);assert.equal(r.quality,undefined);assert.equal(r.direct,undefined);
 assert.equal(r.infoHash,'0123456789012345678901234567890123456789');assert.equal(r.publishDate,'2026-10-16T00:00:00Z');
 assert.equal(r.downloadUrl,r.magnetUrl);
});
test('an exhausted native fanout does not prevent a provider-scoped search and retry uses quota expiry',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async input=>Response.json(String(input).startsWith(config.PROWLARR_URL)?[{id:3,fields:[{name:'baseSettings.queryLimit',value:60},{name:'baseSettings.limitsUnit',value:1}]}]:[1,3].map((id,i)=>({id:10+i,enableInteractiveSearch:true,fields:[{name:'baseUrl',value:`http://prowlarr:9696/${id}/api`}]})));
 const insert=db().prepare("INSERT INTO acquisition_requests(kind,indexer_id,created_at) VALUES('test',3,datetime('now','-30 minutes'))");
 db().transaction(()=>{for(let i=0;i<60;i++)insert.run()})();
 try{
  await assert.rejects(reserveSearch('artist'),error=>{
   assert.ok(error instanceof SearchDeferred);
   const delay=Date.parse(error.retryAt)-Date.now();assert.ok(delay>29*60_000&&delay<31*60_000);return true;
  });
  await reserveSearch('direct',[1]);
  assert.equal((db().prepare('SELECT count(*) n FROM acquisition_requests WHERE indexer_id=1').get() as {n:number}).n,1);
 }finally{globalThis.fetch=original}
});

test('provider hourly and daily settings are enforced locally even for interactive requests',async()=>{
 db().exec('DELETE FROM acquisition_requests');
 const insert=db().prepare("INSERT INTO acquisition_requests(kind,indexer_id) VALUES('test',4)");
 db().transaction(()=>{for(let i=0;i<60;i++)insert.run()})();
 await assert.rejects(reserveSearch('direct',[4],{hourly:60}),/budget exhausted/);
 await reserveSearch('direct',[10],{hourly:300});
 db().exec('DELETE FROM acquisition_requests');
 db().prepare("INSERT INTO acquisition_requests(kind,indexer_id,created_at) VALUES('test',6,datetime('now','-2 hours'))").run();
 await assert.rejects(reserveSearch('direct',[6],{daily:1}),/budget exhausted/);
});
