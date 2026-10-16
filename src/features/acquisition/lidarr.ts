import { config } from "@/config";
import { db } from "@/features/db/client";
import type { CatalogAlbum, Release } from "./matching";
import {releaseInfoHash} from './qbittorrent';
import {configuredRequestLimits,type LimitField,type RequestLimits} from './source-limits';
async function call<T>(path:string,init:RequestInit={}){
  const response=await fetch(`${config.LIDARR_URL}/api/v1${path}`,{...init,headers:{"X-Api-Key":config.LIDARR_API_KEY,"Content-Type":"application/json",...init.headers},signal:AbortSignal.timeout(60_000)});
  if(response.status===429){const value=response.headers.get('retry-after')??'';const seconds=Number(value);const retry=seconds>0?Date.now()+seconds*1000:Date.parse(value);throw new SearchDeferred(new Date(Number.isFinite(retry)?retry:Date.now()+900_000).toISOString(),'Lidarr rate limited')}
  if(!response.ok){const detail=(await response.text()).replace(/([?&]apikey=)[^&\s"<]+/gi,'$1[redacted]');throw new Error(`Lidarr ${path} failed (${response.status}): ${detail}`)}
  const text=await response.text();return(text?JSON.parse(text):undefined)as T;
}
export type Wanted={id:number;artistId:number;title:string;albumType?:string;artist?:{artistName?:string};statistics?:{trackFileCount?:number;totalTrackCount?:number;percentOfTracks?:number}};
export type QueueItem={id:number;albumId?:number;artistId?:number;title?:string;status?:string;trackedDownloadStatus?:string;trackedDownloadState?:string;size?:number;sizeleft?:number;errorMessage?:string;statusMessages?:Array<{title?:string;messages?:string[]}>;downloadId?:string;indexer?:string;trackFileCount?:number;added?:string;outputPath?:string};
// Keep each request below the timeout while Lidarr processes a cold import backlog.
export const wantedMissing=async()=>{const size=100,first=await call<{totalRecords:number;records:Wanted[]}>(`/wanted/missing?page=1&pageSize=${size}&sortKey=title&sortDirection=ascending&monitored=true`),records=[...first.records];for(let page=2;page<=Math.ceil(first.totalRecords/size);page++)records.push(...(await call<{records:Wanted[]}>(`/wanted/missing?page=${page}&pageSize=${size}&sortKey=title&sortDirection=ascending&monitored=true`)).records);return records};
export const queue=()=>call<{records:QueueItem[]}>("/queue?page=1&pageSize=1000&includeUnknownArtistItems=true").then(value=>value.records??[]);
export const releases=(albumId:number)=>call<Array<Record<string,unknown>>>(`/release?albumId=${albumId}`);
export const grabRelease=(release:Record<string,unknown>)=>call("/release",{method:"POST",body:JSON.stringify(release)});
export function releasePushPayload(release:Release):Release {
  // Prowlarr's search DTO is not Lidarr's push DTO. For example its flags are
  // an array, whereas Lidarr requires an integer. Pass transport/identity
  // fields explicitly and let Lidarr re-evaluate quality from the title.
  const fields=['title','guid','downloadUrl','magnetUrl','infoHash','size','seeders','publishDate','protocol','indexer','indexerId','albumId','artistId','downloadClientId'];
  return {...Object.fromEntries(fields.filter(key=>release[key]!==undefined).map(key=>[key,release[key]])),
    // This Lidarr version derives its push GUID from DownloadUrl, including
    // magnet submissions. Keep distinct torrents from sharing a blank GUID.
    ...(release.downloadUrl||release.magnetUrl?{downloadUrl:release.downloadUrl||release.magnetUrl}:{}),
    indexerFlags:typeof release.indexerFlags==='number'?release.indexerFlags:0};
}
export const pushRelease=(release:Release)=>call<Release>("/release/push",{method:"POST",body:JSON.stringify(releasePushPayload(release))});
export const album=(id:number)=>call<CatalogAlbum>(`/album/${id}`);
export const parseRelease=(title:string)=>call<{artist?:{id:number};albums?:Array<{id:number}>}>(`/parse?title=${encodeURIComponent(title)}`);
export const albumCatalog=(artistId:number)=>call<CatalogAlbum[]>(`/album?artistId=${artistId}`);
export const releaseTracks=(releaseId:number)=>call<import('./import-proof').ReleaseTrack[]>(`/track?albumReleaseId=${releaseId}`);
export const trackFiles=(albumId:number)=>call<Array<{id:number;albumId:number;path:string}>>(`/trackfile?albumId=${albumId}`);
export const artistReleases=(artistId:number)=>call<Release[]>(`/release?artistId=${artistId}`);
export const grabsSince=(date:string)=>call<Array<{sourceTitle:string;downloadId?:string;albumId?:number;data?:{torrentInfoHash?:string}}>>('/history/since?'+new URLSearchParams({date,eventType:'1'}));
let blockedCache:{expires:number;titles:Set<string>;hashes:Set<string>}|undefined;
const blockedKey=(title:string)=>title.replace(/&amp;/gi,'&').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export async function releaseIsBlocked(item:Release){
  if(!blockedCache||blockedCache.expires<Date.now()){
    const titles=new Set<string>(),hashes=new Set<string>();let page=1,total=Infinity;
    while((page-1)*100<total){const x=await call<{totalRecords:number;records:Array<{sourceTitle:string;torrentInfoHash?:string}>}>(`/blocklist?page=${page}&pageSize=100&sortKey=date&sortDirection=descending`);total=x.totalRecords;for(const r of x.records){titles.add(blockedKey(r.sourceTitle));if(r.torrentInfoHash)hashes.add(r.torrentInfoHash.toLowerCase())}page++}
    blockedCache={expires:Date.now()+300_000,titles,hashes};
  }
  return blockedCache.titles.has(blockedKey(String(item.title??'')))||blockedCache.hashes.has(releaseInfoHash(item));
}
export class SearchDeferred extends Error {
  constructor(public retryAt: string, message: string) { super(message); }
}
let indexerCache: {expires:number;ids:number[];limits:Map<number,RequestLimits>}|undefined;
export async function reserveSearch(kind:string,indexerIds?:number[],limits?:RequestLimits) {
  const native=!indexerIds;
  if (!indexerIds) {
    if (!indexerCache || indexerCache.expires<Date.now()) {
      const rows=await call<Array<{id:number;enableInteractiveSearch:boolean;fields?:Array<{name:string;value?:unknown}>}>>("/indexer");
      const response=await fetch(`${config.PROWLARR_URL}/api/v1/indexer`,{headers:{'X-Api-Key':config.PROWLARR_API_KEY},signal:AbortSignal.timeout(15_000)});
      if(!response.ok)throw new SearchDeferred(new Date(Date.now()+5*60_000).toISOString(),'Provider limits temporarily unavailable');
      const providers=await response.json() as Array<{id:number;fields?:LimitField[]}>;
      indexerCache={expires:Date.now()+300_000,limits:new Map(providers.map(p=>[p.id,configuredRequestLimits(p.fields)])),ids:rows.filter(r=>r.enableInteractiveSearch).map(r=>{
        const url=String(r.fields?.find(f=>f.name==='baseUrl')?.value??'');
        const mapped=/\/(\d+)(?:\/api)?\/?$/.exec(url);
        return mapped?Number(mapped[1]):-r.id;
      })};
    }
    // Native and Prowlarr namespaces are separate. Direct queries reserve the
    // global pool too. Interactive requests can bypass Prowlarr query limits,
    // so enforce the configured limits locally as well.
    indexerIds=indexerCache.ids;
  }
  db().transaction(()=>{
    let retry=0;
    for(const id of indexerIds!) {
      const configured=limits??(native?indexerCache?.limits.get(id):undefined)??{};
      const hourly=Math.min(300,configured.hourly??300),daily=Math.min(3000,configured.daily??3000);
      const n=db().prepare("SELECT sum(created_at>=datetime('now','-1 hour')) hourly,count(*) daily FROM acquisition_requests WHERE indexer_id=? AND created_at>=datetime('now','-1 day')").get(id) as {hourly:number;daily:number};
      for(const [count,limit,windowMs,window] of [[n.hourly,hourly,3600_000,'-1 hour'],[n.daily,daily,86400_000,'-1 day']] as const){
        if(count<limit)continue;
        const first=db().prepare("SELECT created_at FROM acquisition_requests WHERE indexer_id=? AND created_at>=datetime('now',?) ORDER BY created_at,id LIMIT 1 OFFSET ?").get(id,window,count-limit) as {created_at:string};
        retry=Math.max(retry,Date.parse(first.created_at.replace(' ','T')+'Z')+windowMs+1000);
      }
    }
    if(retry)throw new SearchDeferred(new Date(retry).toISOString(),"Indexer request budget exhausted");
    for(const id of indexerIds!)db().prepare("INSERT INTO acquisition_requests(kind,indexer_id) VALUES(?,?)").run(kind,id);
  }).immediate();
}
export const searchAlbums=(ids:number[])=>ids.length?call("/command",{method:"POST",body:JSON.stringify({name:"AlbumSearch",albumIds:ids})}):Promise.resolve();
export async function blocklistQueue(item:QueueItem){return call(`/queue/${item.id}?removeFromClient=true&blocklist=true&skipRedownload=false&changeCategory=false`,{method:"DELETE"})}
// Ignore a proven wrong catalogue mapping without deleting, moving, marking
// imported, or globally blocklisting a legitimate studio-album payload.
export const retainMismatchedQueue=(item:QueueItem)=>call(`/queue/${item.id}?removeFromClient=false&blocklist=false&skipRedownload=true&changeCategory=false`,{method:'DELETE'});
export const artist=(id:number)=>call<Record<string,unknown>&{id:number;qualityProfileId:number}>(`/artist/${id}`);
export const updateArtist=(value:Record<string,unknown>&{id:number})=>call(`/artist/${value.id}`,{method:"PUT",body:JSON.stringify(value)});
export const profiles=()=>call<Array<Record<string,unknown>&{id:number;name:string}>>("/qualityprofile");
export const createProfile=(value:Record<string,unknown>)=>call<Record<string,unknown>&{id:number}>("/qualityprofile",{method:"POST",body:JSON.stringify(value)});
export const manualImport=(downloadId:string)=>call<Array<Record<string,unknown>>>(`/manualimport?downloadId=${encodeURIComponent(downloadId)}&filterExistingFiles=true`);
export const manualImportFolder=(folder:string,artistId?:number)=>call<Array<Record<string,unknown>>>('/manualimport?'+new URLSearchParams({folder,...(artistId?{artistId:String(artistId)}:{}),filterExistingFiles:'true'}));
export const recheckManualImport=(items:Record<string,unknown>[])=>call<Array<Record<string,unknown>>>('/manualimport',{method:'POST',body:JSON.stringify(items)});
type Command={id:number;status?:string;message?:string;body?:{message?:string}};
export async function importFiles(files:Record<string,unknown>[]){
  const started=await call<Command>("/command",{method:"POST",body:JSON.stringify({name:"ManualImport",files,importMode:"copy",replaceExistingFiles:false})});
  if(!started?.id)throw new Error("Lidarr did not return a command id for manual import");
  for(let attempt=0;attempt<300;attempt++){
    const command=await call<Command>(`/command/${started.id}`);
    const status=String(command.status??"").toLowerCase();
    if(status==="completed")return command;
    if(status==="failed")throw new Error(`Lidarr manual import failed: ${command.message??command.body?.message??"unknown error"}`);
    await new Promise(resolve=>setTimeout(resolve,1_000));
  }
  throw new Error(`Lidarr manual import command ${started.id} did not finish within 5 minutes`);
}
