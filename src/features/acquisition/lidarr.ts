import { config } from "@/config";
import { db } from "@/features/db/client";
import type { CatalogAlbum, Release } from "./matching";
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
export const pushRelease=(release:Release)=>call<Release>("/release/push",{method:"POST",body:JSON.stringify(release)});
export const album=(id:number)=>call<CatalogAlbum>(`/album/${id}`);
export const parseRelease=(title:string)=>call<{artist?:{id:number};albums?:Array<{id:number}>}>(`/parse?title=${encodeURIComponent(title)}`);
export const albumCatalog=(artistId:number)=>call<CatalogAlbum[]>(`/album?artistId=${artistId}`);
export const artistReleases=(artistId:number)=>call<Release[]>(`/release?artistId=${artistId}`);
let blockedCache:{expires:number;titles:Set<string>}|undefined;
const blockedKey=(title:string)=>title.replace(/&amp;/gi,'&').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export async function releaseIsBlocked(item:Release){
  if(!blockedCache||blockedCache.expires<Date.now()){
    const titles=new Set<string>();let page=1,total=Infinity;
    while((page-1)*100<total){const x=await call<{totalRecords:number;records:Array<{sourceTitle:string}>}>(`/blocklist?page=${page}&pageSize=100&sortKey=date&sortDirection=descending`);total=x.totalRecords;for(const r of x.records)titles.add(blockedKey(r.sourceTitle));page++}
    blockedCache={expires:Date.now()+300_000,titles};
  }
  return blockedCache.titles.has(blockedKey(String(item.title??'')));
}
export class SearchDeferred extends Error {
  constructor(public retryAt: string, message: string) { super(message); }
}
let indexerCache: {expires:number;ids:number[]}|undefined;
export async function reserveSearch(kind:string,indexerIds?:number[]) {
  if (!indexerIds) {
    if (!indexerCache || indexerCache.expires<Date.now()) {
      const rows=await call<Array<{id:number;enableInteractiveSearch:boolean;fields?:Array<{name:string;value?:unknown}>}>>("/indexer");
      indexerCache={expires:Date.now()+300_000,ids:rows.filter(r=>r.enableInteractiveSearch).map(r=>{
        const url=String(r.fields?.find(f=>f.name==='baseUrl')?.value??'');
        const mapped=/\/(\d+)(?:\/api)?\/?$/.exec(url);
        return mapped?Number(mapped[1]):-r.id;
      })};
    }
    // Native and Prowlarr namespaces are separate. Direct queries reserve the
    // global pool too; Prowlarr remains authoritative for provider quotas.
    indexerIds=indexerCache.ids;
  }
  const retryAt=new Date(Date.now()+15*60_000).toISOString();
  db().transaction(()=>{
    for(const id of indexerIds!) {
      const n=db().prepare("SELECT sum(created_at>=datetime('now','-1 hour')) hourly,count(*) daily FROM acquisition_requests WHERE indexer_id=? AND created_at>=datetime('now','-1 day')").get(id) as {hourly:number;daily:number};
      if(n.hourly>=300||n.daily>=3000)throw new SearchDeferred(retryAt,"Indexer request budget exhausted");
    }
    for(const id of indexerIds!)db().prepare("INSERT INTO acquisition_requests(kind,indexer_id) VALUES(?,?)").run(kind,id);
  }).immediate();
}
export const searchAlbums=(ids:number[])=>ids.length?call("/command",{method:"POST",body:JSON.stringify({name:"AlbumSearch",albumIds:ids})}):Promise.resolve();
export async function blocklistQueue(item:QueueItem){return call(`/queue/${item.id}?removeFromClient=true&blocklist=true&skipRedownload=false&changeCategory=false`,{method:"DELETE"})}
export const artist=(id:number)=>call<Record<string,unknown>&{id:number;qualityProfileId:number}>(`/artist/${id}`);
export const updateArtist=(value:Record<string,unknown>&{id:number})=>call(`/artist/${value.id}`,{method:"PUT",body:JSON.stringify(value)});
export const profiles=()=>call<Array<Record<string,unknown>&{id:number;name:string}>>("/qualityprofile");
export const createProfile=(value:Record<string,unknown>)=>call<Record<string,unknown>&{id:number}>("/qualityprofile",{method:"POST",body:JSON.stringify(value)});
export const manualImport=(downloadId:string)=>call<Array<Record<string,unknown>>>(`/manualimport?downloadId=${encodeURIComponent(downloadId)}&filterExistingFiles=true`);
export const manualImportFolder=(folder:string,artistId?:number)=>call<Array<Record<string,unknown>>>('/manualimport?'+new URLSearchParams({folder,...(artistId?{artistId:String(artistId)}:{}),filterExistingFiles:'true'}));
type Command={id:number;status?:string;message?:string;body?:{message?:string}};
export async function importFiles(files:Record<string,unknown>[]){
  const started=await call<Command>("/command",{method:"POST",body:JSON.stringify({name:"ManualImport",files,importMode:"auto"})});
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
