import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {config} from '@/config';
import {db,stateGet} from '@/features/db/client';
import {clearDiscoveryCache,directCandidates} from './discovery';
const dir=mkdtempSync(join(tmpdir(),'curator-discovery-'));config.DATABASE_PATH=join(dir,'test.sqlite');
after(()=>{db().close();rmSync(dir,{recursive:true,force:true})});
test('an unavailable preferred provider cannot suppress other sources or turn healthy zero results into errors',async()=>{
  const original=globalThis.fetch;const queried:number[]=[];
  clearDiscoveryCache();
  globalThis.fetch=async input=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith('/indexer'))return Response.json([{id:1,name:'The Pirate Bay',enable:true},{id:3,name:'LimeTorrents',enable:true},{id:12,name:'TorrentKitty',enable:true}]);
    const id=Number(url.searchParams.get('indexerIds'));queried.push(id);
    assert.equal(url.searchParams.get('query'),'Sounds of Soul Deep Volume 7');
    return id===1?Response.json({message:'Search failed due to all selected indexers being unavailable'},{status:400}):Response.json([]);
  };
  try{
    assert.deepEqual(await directCandidates('Various Artists','Sounds of Soul Deep, Volume 7'),[]);
    assert.deepEqual(queried,[3,1,12]);
    assert.match(stateGet('acquisition_source_error:1'),/temporarily unavailable/);
    clearDiscoveryCache();
    // An exhausted first provider must not stop a healthy provider either.
    db().prepare("UPDATE state SET value='0' WHERE key IN ('acquisition_source_wait:12','acquisition_source_wait:3')").run();
    const insert=db().prepare("INSERT INTO acquisition_requests(kind,indexer_id) VALUES('test',3)");
    db().transaction(()=>{for(let i=0;i<300;i++)insert.run()})();
    queried.length=0;
    assert.deepEqual(await directCandidates('Various Artists','Sounds of Soul Deep, Volume 7'),[]);
    assert.deepEqual(queried,[12]);
    assert.match(stateGet('acquisition_source_error:3'),/budget exhausted/);
  }finally{globalThis.fetch=original}
});
