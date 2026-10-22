import {createHash} from 'node:crypto';
import {db,stateGet,stateSet} from '@/features/db/client';
import {openWebPage,webSearch,type OpenedPage} from '@/features/ai/web-tools';

export type DiscoveryRequestKind='api'|'editorial'|'search'|'identity';
export class DiscoverySourceDeferred extends Error{}
const limits={total:100,editorial:20,search:5};
export function reserveDiscoveryRequest(provider:string,kind:DiscoveryRequestKind,now=Date.now()){
  return db().transaction(()=>{
    const cooldown=Number(stateGet(`playlist_source_cooldown:${provider}`,'0'));
    if(cooldown>now)throw new DiscoverySourceDeferred(`${provider} is cooling down`);
    const day=new Date(now).setUTCHours(0,0,0,0);
    const counts=db().prepare("SELECT count(*) total,sum(kind='editorial') editorial,sum(kind='search') search FROM playlist_source_requests WHERE created_at>=?").get(day) as {total:number;editorial:number;search:number};
    if(counts.total>=limits.total||kind==='editorial'&&counts.editorial>=limits.editorial||kind==='search'&&counts.search>=limits.search)throw new DiscoverySourceDeferred('Daily discovery request budget exhausted');
    return Number(db().prepare('INSERT INTO playlist_source_requests(provider,kind,created_at) VALUES(?,?,?)').run(provider,kind,now).lastInsertRowid);
  }).immediate();
}
function retryAt(response:Response,now=Date.now()){
  const raw=response.headers.get('retry-after')??'',seconds=Number(raw),reset=Number(response.headers.get('x-ratelimit-reset-in'));
  return Math.max(now+60_000,seconds>0?now+seconds*1000:Date.parse(raw)||0,reset>0?now+reset*1000:0);
}
async function providerSlot(provider:string){
  const interval=provider==='listenbrainz'?1100:1000;
  while(true){
    const wait=db().transaction(()=>{
      const now=Date.now(),next=Number(stateGet(`playlist_source_next:${provider}`,'0'));
      if(next>now)return next-now;
      stateSet(`playlist_source_next:${provider}`,String(now+interval));return 0;
    }).immediate();
    if(!wait)return;await new Promise(r=>setTimeout(r,wait));
  }
}
export async function cachedDiscoveryRequest<T>(provider:string,key:string,kind:DiscoveryRequestKind,ttlDays:number,load:()=>Promise<T>,decode?:(raw:unknown)=>T):Promise<{value:T;fetchedAt:string;cached:boolean}>{
  const cacheKey=createHash('sha256').update(provider+':'+key).digest('hex'),now=Date.now();
  const cached=db().prepare('SELECT payload_json,fetched_at,expires_at FROM playlist_source_cache WHERE cache_key=?').get(cacheKey) as {payload_json:string;fetched_at:number;expires_at:number}|undefined;
  if(cached&&cached.expires_at>now){
    try{const raw=JSON.parse(cached.payload_json);return{value:decode?decode(raw):raw,fetchedAt:new Date(cached.fetched_at).toISOString(),cached:true}}
    catch{db().prepare('DELETE FROM playlist_source_cache WHERE cache_key=?').run(cacheKey)}
  }
  await providerSlot(provider);
  const receipt=reserveDiscoveryRequest(provider,kind);
  try{
    const value=await load(),fetched=Date.now();
    db().prepare('INSERT INTO playlist_source_cache(cache_key,provider,kind,payload_json,fetched_at,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at')
      .run(cacheKey,provider,kind,JSON.stringify(value),fetched,fetched+ttlDays*86400_000);
    db().prepare("UPDATE playlist_source_requests SET status='success' WHERE id=?").run(receipt);
    stateSet(`playlist_source_error:${provider}`,'');return{value,fetchedAt:new Date(fetched).toISOString(),cached:false};
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    db().prepare("UPDATE playlist_source_requests SET status='failed',detail=? WHERE id=?").run(message.slice(0,300),receipt);
    stateSet(`playlist_source_error:${provider}`,message.slice(0,300));
    if(!(error instanceof DiscoverySourceDeferred))stateSet(`playlist_source_cooldown:${provider}`,String(Math.max(Number(stateGet(`playlist_source_cooldown:${provider}`,'0')),Date.now()+15*60_000)));
    throw error;
  }
}
export async function discoveryJson<T>(provider:string,url:string,ttlDays=7,kind:DiscoveryRequestKind='api',gate?:(load:()=>Promise<T>)=>Promise<T>,decode?:(raw:unknown)=>T){
  const keyUrl=new URL(url);for(const key of ['api_key','token'])keyUrl.searchParams.delete(key);
  return cachedDiscoveryRequest<T>(provider,keyUrl.toString(),kind,ttlDays,async()=>{
    const request=async()=>{
    const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'MusicCurator/3.0 (+https://curator.blizzard.busykoala.io/)'},signal:AbortSignal.timeout(15_000)});
    if(response.status===429||response.status===503){stateSet(`playlist_source_cooldown:${provider}`,String(retryAt(response)));throw new DiscoverySourceDeferred(`${provider} returned ${response.status}; retry scheduled`)}
    if(!response.ok)throw Error(`${provider} returned HTTP ${response.status}`);
    if(response.headers.get('x-ratelimit-remaining')==='0')stateSet(`playlist_source_cooldown:${provider}`,String(retryAt(response)));
    const raw=await response.json();return decode?decode(raw):raw as T;
    };
    return gate?gate(request):request();
  },decode);
}
export function discoveryPage(provider:string,url:string){return cachedDiscoveryRequest<OpenedPage>(provider,url,'editorial',7,()=>openWebPage(url))}
export function discoveryWebSearch(query:string){return cachedDiscoveryRequest('web-search',query,'search',7,()=>webSearch(query))}
