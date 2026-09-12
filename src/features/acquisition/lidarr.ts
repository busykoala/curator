import { config } from "@/config";
async function call<T>(path:string,init:RequestInit={}){const response=await fetch(`${config.LIDARR_URL}/api/v1${path}`,{...init,headers:{"X-Api-Key":config.LIDARR_API_KEY,"Content-Type":"application/json",...init.headers},signal:AbortSignal.timeout(60_000)});if(!response.ok)throw new Error(`Lidarr ${path} failed (${response.status}): ${await response.text()}`);const text=await response.text();return(text?JSON.parse(text):undefined)as T}
export type Wanted={id:number;artistId:number;title:string;artist?:{artistName?:string};statistics?:{trackFileCount?:number;totalTrackCount?:number;percentOfTracks?:number}};
export type QueueItem={id:number;albumId?:number;artistId?:number;title?:string;status?:string;trackedDownloadStatus?:string;trackedDownloadState?:string;size?:number;sizeleft?:number;errorMessage?:string;statusMessages?:Array<{title?:string;messages?:string[]}>;downloadId?:string;indexer?:string;trackFileCount?:number;added?:string};
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
