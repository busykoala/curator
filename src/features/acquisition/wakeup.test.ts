import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('startup records a durable wake-up and a restart lease cannot consume it',async(t)=>{
  const dir=mkdtempSync(join(tmpdir(),'curator-wakeup-'));process.env.DATABASE_PATH=join(dir,'db.sqlite');
  const {db,stateSet,stateGet}=await import('@/features/db/client'),{runRequestedAcquisitionCycle,startAcquisitionController}=await import('./controller');
  t.mock.timers.enable({apis:['setInterval','setTimeout']});
  const listeners=new Set(process.listeners('SIGTERM'));
  const fetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('A leased-out worker must not call services')};
  try{stateSet('acquisition_lease',String(Date.now()+240_000));stateSet('acquisition_requested_action','');startAcquisitionController();assert.equal(stateGet('acquisition_requested_action'),'run');await runRequestedAcquisitionCycle();assert.equal(stateGet('acquisition_requested_action'),'run')}
  finally{for(const listener of process.listeners('SIGTERM'))if(!listeners.has(listener))process.removeListener('SIGTERM',listener);globalThis.fetch=fetch;db().close();rmSync(dir,{recursive:true,force:true})}
});
