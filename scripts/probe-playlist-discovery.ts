import {mkdirSync,writeFileSync} from 'node:fs';
import Database from 'better-sqlite3';
import {config} from '../src/config';
import {db} from '../src/features/db/client';
import {getPlaylist} from '../src/features/playlists/repository';
import {listenBrainzCandidates,listenBrainzTagCandidates} from '../src/features/playlists/discovery-providers';
import {discoveryReleaseFit} from '../src/features/playlists/discovery-fit';
async function main(){
  const target=process.env.PLAYLIST_EVAL_DB_PATH,ratePath=process.env.PLAYLIST_EVAL_SHARED_RATE_DB;
  if(!target?.startsWith('/tmp/curator-renewal-eval-')||!target.endsWith('.sqlite')||config.DATABASE_PATH!==target||ratePath!=='/app/data/curator.sqlite')throw Error('Requires an isolated evaluation database and the explicitly supplied production rate-state path');
  const database=db(),rates=new Database(ratePath,{fileMustExist:true,timeout:2000}),playlist=getPlaylist(6);
  if(!playlist||playlist.category!=='discovery')throw Error('Expected the existing Discovery canary');
  const read=rates.prepare('SELECT value FROM state WHERE key=?'),write=rates.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP');
  const day=new Date().toISOString().slice(0,10),budgetKey='playlist_renewal_probe_requests:'+day,original=globalThis.fetch;
  const cap=Math.max(1,Math.min(40,Number(process.env.PLAYLIST_EVAL_PROOF_CAP??20))),requests:Array<Record<string,unknown>>=[];
  globalThis.fetch=async(input,options)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.toString():input.url);
    if(url.hostname==='musicbrainz.org')for(;;){
      const wait=rates.transaction(()=>{
        const now=Date.now(),cooldown=Number((read.get('musicbrainz_cooldown_until') as {value:string}|undefined)?.value??0);
        if(cooldown>now)throw Error('Shared MusicBrainz cooldown is active');
        const next=Number((read.get('musicbrainz_next_request') as {value:string}|undefined)?.value??0);
        if(next>now)return next-now;write.run('musicbrainz_next_request',String(now+1100));return 0;
      }).immediate();
      if(!wait)break;await new Promise(resolve=>setTimeout(resolve,wait));
    }
    rates.transaction(()=>{const used=Number((read.get(budgetKey) as {value:string}|undefined)?.value??0);if(used>=cap)throw Error('Discovery proof request budget exhausted');write.run(budgetKey,String(used+1))}).immediate();
    const started=Date.now();
    try{
      const response=await original(input,options);requests.push({host:url.hostname,path:url.pathname,status:response.status,durationMs:Date.now()-started});
      if(url.hostname==='musicbrainz.org'&&[429,503].includes(response.status)){
        const retry=Number(response.headers.get('retry-after')??0);write.run('musicbrainz_cooldown_until',String(Date.now()+Math.max(300000,retry*1000)));
      }
      return response;
    }catch(error){requests.push({host:url.hostname,path:url.pathname,error:String(error),durationMs:Date.now()-started});throw error}
  };
  const started=Date.now();
  try{
    const mode=process.env.PLAYLIST_EVAL_SOURCE_MODE==='tags'?'tags':'artist',candidates=await(mode==='tags'?listenBrainzTagCandidates:listenBrainzCandidates)(playlist,false),output=process.env.PLAYLIST_EVAL_OUTPUT??'/tmp/curator-renewal-eval-code/discovery-probe';mkdirSync(output,{recursive:true});
    const report={at:new Date().toISOString(),mode,cap,scope:'Live free-provider resolution only; caches in the isolated copy; no playlist/acquisition mutations. Production writes are limited to existing shared MusicBrainz timing/cooldown state and the bounded proof request counter.',durationMs:Date.now()-started,requests,
      candidates:candidates.map(release=>({...release,fit:discoveryReleaseFit(playlist,release)}))};
    writeFileSync(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({durationMs:report.durationMs,requests:requests.length,candidates:candidates.length,fit:candidates.filter(release=>discoveryReleaseFit(playlist,release)).length,statuses:requests.map(request=>request.status??request.error)}));
  }finally{globalThis.fetch=original;rates.close();database.close()}
}
void main().catch(error=>{console.error(String(error));process.exitCode=1});
