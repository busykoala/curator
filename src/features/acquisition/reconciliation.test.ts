import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {synchronizeTargets} from './controller';
import {targetByAlbum,updateTarget} from './repository';
const dir=mkdtempSync(join(tmpdir(),'curator-reconcile-'));config.DATABASE_PATH=join(dir,'test.sqlite');
after(()=>{db().close();rmSync(dir,{recursive:true,force:true})});
test('newly monitored Lidarr releases are discovered on every poll, without a Curator request',async()=>{
  await synchronizeTargets([{id:1,artistId:10,title:'First',artist:{artistName:'Artist'}}]);
  assert.equal(targetByAlbum(1)?.status,'pending');
  await synchronizeTargets([{id:1,artistId:10,title:'First'},{id:2,artistId:10,title:'Newly monitored'}]);
  assert.equal(targetByAlbum(2)?.status,'pending');
  assert.equal(targetByAlbum(2)?.origin,'migration');
});
test('unmonitoring is not an import, actual completed files are confirmed once, and remonitoring resumes acquisition',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(input)=>Response.json(String(input).endsWith('/1')?{id:1,monitored:false,statistics:{trackFileCount:0,percentOfTracks:0}}:{id:2,monitored:true,statistics:{trackFileCount:12,percentOfTracks:100}});
  try{
    updateTarget(targetByAlbum(2)!.id,{source_name:'Test source',status:'downloaded',download_hash:'abc'});
    await synchronizeTargets([]);
    assert.equal(targetByAlbum(1)?.status,'inactive');assert.equal(targetByAlbum(2)?.status,'imported');
    await synchronizeTargets([]);
    assert.equal((db().prepare("SELECT count(*) n FROM source_outcomes WHERE event='import'").get() as {n:number}).n,1);
    await synchronizeTargets([{id:1,artistId:10,title:'First'}]);assert.equal(targetByAlbum(1)?.status,'pending');
  }finally{globalThis.fetch=original}
});
