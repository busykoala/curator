import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {db,stateGet} from '@/features/db/client';
export class InferenceYieldError extends Error{readonly inferenceYield=true}

// Shared across web, enrichment, acquisition, chat and refresh processes. The
// gate is opt-in with the playlist rollout; separate CPU retrieval is ungated.
export async function runSharedInference<T>(operation:(signal:AbortSignal)=>Promise<T>,signal:AbortSignal,priority:'interactive'|'background'):Promise<T>{
  if(stateGet('playlist_refresh_mode','off')==='off')return operation(signal);
  signal.throwIfAborted();const id=randomUUID(),now=Date.now();let acquired=false;
  db().prepare('INSERT INTO playlist_inference_queue(id,priority,created_at,expires_at) VALUES(?,?,?,?)').run(id,priority,now,now+240_000);
  try{
    while(!acquired){
      signal.throwIfAborted();
      acquired=db().transaction(()=>{
        const stamp=Date.now();
        db().prepare('DELETE FROM playlist_inference_queue WHERE expires_at<=?').run(stamp);
        db().prepare('INSERT OR IGNORE INTO playlist_inference_slot(id) VALUES(1)').run();
        if(priority==='background'&&(stateGet('paused')==='true'||db().prepare("SELECT 1 FROM playlist_chat_jobs WHERE status IN ('queued','running') LIMIT 1").get()))throw new InferenceYieldError('Background inference yielded to interactive chat or a pause');
        const first=db().prepare("SELECT id FROM playlist_inference_queue ORDER BY priority='interactive' DESC,created_at,id LIMIT 1").get() as {id:string}|undefined;
        if(first?.id!==id)return false;
        const result=db().prepare('UPDATE playlist_inference_slot SET lease_token=?,lease_until=? WHERE id=1 AND lease_until<=?').run(id,stamp+30_000,stamp);
        if(result.changes)db().prepare('DELETE FROM playlist_inference_queue WHERE id=?').run(id);
        return Boolean(result.changes);
      }).immediate();
      if(!acquired)await delay(100,undefined,{signal});
    }
    const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
    const heartbeat=setInterval(()=>{
      try{
        const changed=db().prepare('UPDATE playlist_inference_slot SET lease_until=? WHERE id=1 AND lease_token=? AND lease_until>?').run(Date.now()+30_000,id,Date.now());
        if(!changed.changes)controller.abort(Error('Inference lease expired'));
        if(priority==='background'&&(db().prepare("SELECT 1 FROM playlist_inference_queue WHERE priority='interactive' LIMIT 1").get()||db().prepare("SELECT 1 FROM playlist_chat_jobs WHERE status IN ('queued','running') LIMIT 1").get()))controller.abort(new InferenceYieldError('Background inference yielded to interactive chat'));
      }catch(error){controller.abort(error)}
    },500);
    try{return await operation(combined)}finally{clearInterval(heartbeat)}
  }finally{
    db().transaction(()=>{
      db().prepare('DELETE FROM playlist_inference_queue WHERE id=?').run(id);
      if(acquired)db().prepare('UPDATE playlist_inference_slot SET lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?').run(id);
    })();
  }
}
