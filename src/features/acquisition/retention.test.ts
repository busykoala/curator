import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('telemetry retention preserves recent progress and quota reservations',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'curator-retention-'));process.env.DATABASE_PATH=join(dir,'db.sqlite');
  const {db}=await import('@/features/db/client'),{pruneAcquisitionTelemetry}=await import('./repository');
  try{
    for(const age of [1,30]){
      db().prepare("INSERT INTO acquisition_requests(kind,indexer_id,created_at) VALUES('search',1,datetime('now',?))").run('-'+age+' days');
      db().prepare("INSERT INTO download_observations(torrent_hash,state,downloaded,amount_left,progress,download_speed,connected_seeds,reported_seeds,observed_at) VALUES('hash','downloading',1,2,.3,0,0,0,datetime('now',?))").run('-'+age+' days');
    }
    pruneAcquisitionTelemetry();
    assert.equal((db().prepare('SELECT count(*) n FROM download_observations').get() as {n:number}).n,1);
    assert.equal((db().prepare('SELECT count(*) n FROM acquisition_requests').get() as {n:number}).n,1);
  }finally{db().close();rmSync(dir,{recursive:true,force:true})}
});
