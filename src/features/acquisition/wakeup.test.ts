import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('a restart lease cannot consume the durable wake-up for a new request',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'curator-wakeup-'));process.env.DATABASE_PATH=join(dir,'db.sqlite');
  const {db,stateSet,stateGet}=await import('@/features/db/client'),{runRequestedAcquisitionCycle}=await import('./controller');
  const fetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('A leased-out worker must not call services')};
  try{stateSet('acquisition_lease',String(Date.now()+240_000));stateSet('acquisition_requested_action','run');await runRequestedAcquisitionCycle();assert.equal(stateGet('acquisition_requested_action'),'run')}
  finally{globalThis.fetch=fetch;db().close();rmSync(dir,{recursive:true,force:true})}
});
