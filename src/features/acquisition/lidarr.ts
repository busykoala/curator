import { config } from "@/config";
async function call<T>(path:string,init:RequestInit={}){const response=await fetch(`${config.LIDARR_URL}/api/v1${path}`,{...init,headers:{"X-Api-Key":config.LIDARR_API_KEY,"Content-Type":"application/json",...init.headers},signal:AbortSignal.timeout(60_000)});if(!response.ok)throw new Error(`Lidarr ${path} failed (${response.status}): ${await response.text()}`);const text=await response.text();return(text?JSON.parse(text):undefined)as T}
export type Wanted={id:number;artistId:number;title:string;artist?:{artistName?:string};statistics?:{trackFileCount?:number;totalTrackCount?:number;percentOfTracks?:number}};
export type QueueItem={id:number;albumId?:number;artistId?:number;title?:string;status?:string;trackedDownloadStatus?:string;trackedDownloadState?:string;size?:number;sizeleft?:number;errorMessage?:string;downloadId?:string;indexer?:string;trackFileCount?:number;added?:string};
export const wantedMissing=async()=>{const size=500,first=await call<{totalRecords:number;records:Wanted[]}>(`/wanted/missing?page=1&pageSize=${size}&sortKey=title&sortDirection=ascending&monitored=true`),records=[...first.records];for(let page=2;page<=Math.ceil(first.totalRecords/size);page++)records.push(...(await call<{records:Wanted[]}>(`/wanted/missing?page=${page}&pageSize=${size}&sortKey=title&sortDirection=ascending&monitored=true`)).records);return records};
export const queue=()=>call<{records:QueueItem[]}>("/queue?page=1&pageSize=1000&includeUnknownArtistItems=true").then(value=>value.records??[]);
export const releases=(albumId:number)=>call<Array<Record<string,unknown>>>(`/release?albumId=${albumId}`);
export const grabRelease=(release:Record<string,unknown>)=>call("/release",{method:"POST",body:JSON.stringify(release)});
export const searchAlbums=(ids:number[])=>ids.length?call("/command",{method:"POST",body:JSON.stringify({name:"AlbumSearch",albumIds:ids})}):Promise.resolve();
export async function blocklistQueue(item:QueueItem){return call(`/queue/${item.id}?removeFromClient=true&blocklist=true&skipRedownload=false&changeCategory=false`,{method:"DELETE"})}
export const artist=(id:number)=>call<Record<string,unknown>&{id:number;qualityProfileId:number}>(`/artist/${id}`);
export const updateArtist=(value:Record<string,unknown>&{id:number})=>call(`/artist/${value.id}`,{method:"PUT",body:JSON.stringify(value)});
export const profiles=()=>call<Array<Record<string,unknown>&{id:number;name:string}>>("/qualityprofile");
export const createProfile=(value:Record<string,unknown>)=>call<Record<string,unknown>&{id:number}>("/qualityprofile",{method:"POST",body:JSON.stringify(value)});
export const manualImport=(downloadId:string)=>call<Array<Record<string,unknown>>>(`/manualimport?downloadId=${encodeURIComponent(downloadId)}&filterExistingFiles=true`);
export const importFiles=(files:Record<string,unknown>[])=>call("/command",{method:"POST",body:JSON.stringify({name:"ManualImport",files,importMode:"auto"})});
