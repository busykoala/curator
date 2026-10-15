import { config } from "@/config";
import { stateGet, stateSet } from "@/features/db/client";
import { artistReleases, releases, reserveSearch, SearchDeferred } from "./lidarr";
import type { Release } from "./matching";

const cache=new Map<string,{expires:number;work:Promise<Release[]>}>();
export function clearDiscoveryCache(){cache.clear();sources=undefined}
async function cached(key:string,work:()=>Promise<Release[]>) {
  const saved=cache.get(key);
  if(saved&&saved.expires>Date.now())return saved.work;
  const promise=work();cache.set(key,{expires:Date.now()+10*60_000,work:promise});
  try{return await promise}catch(error){cache.delete(key);throw error}
}
export const nativeAlbum=(id:number)=>cached(`album:${id}`,async()=>{await reserveSearch("album");return releases(id)});
export const nativeArtist=(id:number)=>cached(`artist:${id}`,async()=>{await reserveSearch("artist");return artistReleases(id)});

type Indexer={id:number;name:string;enable:boolean};
let sources:{expires:number;rows:Indexer[]}|undefined;
async function prowlarr<T>(path:string):Promise<T> {
  const r=await fetch(`${config.PROWLARR_URL}/api/v1${path}`,{headers:{"X-Api-Key":config.PROWLARR_API_KEY},signal:AbortSignal.timeout(45_000)});
  if(r.status===429)throw new SearchDeferred(new Date(Date.now()+Math.max(60,Number(r.headers.get("retry-after"))||900)*1000).toISOString(),"Prowlarr rate limited");
  if(!r.ok)throw Error(`Prowlarr search failed (${r.status})`);
  return r.json();
}
export async function directCandidates(artist:string,title:string) {
  if(!sources||sources.expires<Date.now())sources={expires:Date.now()+300_000,rows:await prowlarr<Indexer[]>("/indexer")};
  const rows=sources.rows.filter(s=>s.enable&&/^(The Pirate Bay|LimeTorrents|TorrentDownload)$/.test(s.name)).slice(0,2);
  // Broaden the query, never the identity acceptance criteria.
  const query=`${artist} ${title.replace(/\([^)]*\)|\[[^\]]*\]/g,' ')}`.replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
  const result:Release[]=[];const errors:unknown[]=[];
  for(const source of rows) {
    const key=`direct:${source.id}:${query}`;
    try{result.push(...await cached(key,async()=>{
      const until=Number(stateGet(`acquisition_source_wait:${source.id}`,"0"));
      if(until>Date.now())throw new SearchDeferred(new Date(until).toISOString(),"Indexer cooling down");
      await reserveSearch("direct",[source.id]);
      stateSet(`acquisition_source_wait:${source.id}`,String(Date.now()+5000));
      const reports=await prowlarr<Release[]>(`/search?query=${encodeURIComponent(query)}&type=search&categories=3000&indexerIds=${source.id}&limit=100`);
      return reports.map(r=>{
        const title=String(r.title??'');
        const quality=/\bflac\b/i.test(title)?'FLAC':/\bmp3\b.*\b320\b|\b320\s*kbps\b/i.test(title)?'MP3-320':/\bmp3\b.*\bv0\b/i.test(title)?'MP3-VBR-V0':'Unknown';
        return {...r,quality:{quality:{name:quality}},indexer:`${source.name} (Prowlarr)`,direct:true};
      });
    }))}catch(error){errors.push(error);if(error instanceof SearchDeferred)stateSet(`acquisition_source_wait:${source.id}`,String(new Date(error.retryAt).getTime()))}
  }
  if(!result.length&&errors.length)throw errors[0];
  return result;
}
