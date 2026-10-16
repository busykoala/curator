import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {reserveSearch,SearchDeferred} from './lidarr';
const dir=mkdtempSync(join(tmpdir(),'curator-request-budget-'));config.DATABASE_PATH=join(dir,'test.sqlite');
after(()=>{db().close();rmSync(dir,{recursive:true,force:true})});
test('an exhausted native fanout does not prevent a provider-scoped search and retry uses quota expiry',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json([1,3].map(id=>({id,enableInteractiveSearch:true,fields:[{name:'baseUrl',value:`http://prowlarr:9696/${id}/api`}]})));
 const insert=db().prepare("INSERT INTO acquisition_requests(kind,indexer_id,created_at) VALUES('test',3,datetime('now','-30 minutes'))");
 db().transaction(()=>{for(let i=0;i<300;i++)insert.run()})();
 try{
  await assert.rejects(reserveSearch('artist'),error=>{
   assert.ok(error instanceof SearchDeferred);
   const delay=Date.parse(error.retryAt)-Date.now();assert.ok(delay>29*60_000&&delay<31*60_000);return true;
  });
  await reserveSearch('direct',[1]);
  assert.equal((db().prepare('SELECT count(*) n FROM acquisition_requests WHERE indexer_id=1').get() as {n:number}).n,1);
 }finally{globalThis.fetch=original}
});
