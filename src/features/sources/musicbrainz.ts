import { cachedJson,fetchJson } from "./cache";
import {db,stateGet,stateSet} from "@/features/db/client";
import { normalized } from "@/features/scanner/normalize";
type Credit={artist:{id:string;name:string};name?:string;joinphrase?:string};
type Tag={name:string;count?:number};
export type MbCandidate={id:string;title:string;disambiguation?:string;"first-release-date"?:string;"primary-type"?:string;"secondary-types"?:string[];"artist-credit"?:Credit[];score?:number;genres?:Tag[];tags?:Tag[]};
type SearchResult={"release-groups":MbCandidate[]};
let cooldownUntil=0;
export function musicBrainzCooldownRemaining():number{return Math.max(0,Math.max(cooldownUntil,Number(stateGet('musicbrainz_cooldown_until','0')))-Date.now())}
async function limited<T>(load:()=>Promise<T>):Promise<T>{
  const check=()=>{const remaining=musicBrainzCooldownRemaining();if(remaining>0){const error=new Error(`503 MusicBrainz cooldown active for ${Math.ceil(remaining/1000)} seconds`) as Error&{status:number};error.status=503;throw error}};
  check();
  // Grant slots at actual request time, including after a delayed timer wakes.
  // Web, enrichment and acquisition share this atomic gate across processes.
  while(true){
    check();
    const wait=db().transaction(()=>{const now=Date.now(),next=Number(stateGet('musicbrainz_next_request','0'));if(next>now)return next-now;stateSet('musicbrainz_next_request',String(now+1100));return 0}).immediate();
    if(!wait)break;
    await new Promise(resolve=>setTimeout(resolve,wait));
  }
  try{return await load()}catch(error){const status=Number((error as{status?:number}).status??0);if(status===429||status===503){cooldownUntil=Date.now()+5*60_000;stateSet('musicbrainz_cooldown_until',String(cooldownUntil))}throw error}
}
const headers={"User-Agent":"MusicCurator/2.0 (self-hosted; contact=local-admin)",Accept:"application/json"};
async function details(candidate:MbCandidate,entityKey:string):Promise<MbCandidate>{const value=await cachedJson("musicbrainz",`release-group-details:${candidate.id}`,entityKey,90,()=>limited(()=>fetchJson<MbCandidate>(`https://musicbrainz.org/ws/2/release-group/${candidate.id}?inc=genres+tags+artist-credits&fmt=json`,{headers},1))).catch(()=>candidate);return{...candidate,...value,score:candidate.score??value.score}}
const searchTtlDays=1/24;
export function catalogueSearchQuery(term:string):string{
  const words=term.normalize("NFKC").match(/[\p{L}\p{N}]+/gu)?.slice(0,24)??[];
  return words.map(word=>`(releasegroup:${JSON.stringify(word)} OR artist:${JSON.stringify(word)})`).join(" AND ");
}
export async function searchCatalogueReleaseGroups(term:string):Promise<SearchResult>{
  const query=catalogueSearchQuery(term);
  if(!query)return{"release-groups":[]};
  return cachedJson("musicbrainz",`catalogue-search:v1:${query}`,`music-search:${normalized(term)}`,searchTtlDays,()=>limited(()=>fetchJson<SearchResult>(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&limit=8&fmt=json`,{headers},1)));
}
export async function searchReleaseGroups(artist:string,album:string,entityKey:string):Promise<SearchResult>{const query=`artist:${JSON.stringify(artist)} AND releasegroup:${JSON.stringify(album)}`,id=`release-group-search:v3:${normalized(artist)}|${normalized(album)}`;const found=await cachedJson("musicbrainz",id,entityKey,searchTtlDays,()=>limited(()=>fetchJson<SearchResult>(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&limit=8&fmt=json`,{headers},1)));const enriched:MbCandidate[]=[];for(const candidate of found["release-groups"].slice(0,5))enriched.push(await details(candidate,entityKey));return{"release-groups":enriched}}
export async function searchReleaseGroupsByAlbum(album:string,entityKey:string):Promise<SearchResult>{const query=`releasegroup:${JSON.stringify(album)}`,id=`release-group-loose:v3:${normalized(album)}`;const found=await cachedJson("musicbrainz",id,entityKey,searchTtlDays,()=>limited(()=>fetchJson<SearchResult>(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&limit=12&fmt=json`,{headers},1)));const enriched:MbCandidate[]=[];for(const candidate of found["release-groups"].slice(0,8))enriched.push(await details(candidate,entityKey));return{"release-groups":enriched}}
function withoutArticle(value:string):string{return normalized(value).replace(/^(?:a|an|the)\s+/,"")}
function similarity(a:string,b:string):number{const compare=(leftValue:string,rightValue:string)=>{const left=new Set(normalized(leftValue).split(" ").filter(Boolean)),right=new Set(normalized(rightValue).split(" ").filter(Boolean));if(!left.size||!right.size)return 0;return[...left].filter(word=>right.has(word)).length/new Set([...left,...right]).size};return Math.max(compare(a,b),compare(withoutArticle(a),withoutArticle(b)))}
export function candidateCatalogTitles(candidate:MbCandidate):string[]{return[candidate.title,...(candidate.disambiguation?[`${candidate.title} (${candidate.disambiguation})`]:[])]}
export function catalogTitleSimilarity(album:string,candidate:MbCandidate):number{return Math.max(...candidateCatalogTitles(candidate).map(title=>similarity(cleanCatalogText(album),cleanCatalogText(title))))}
export function hasPlausibleCatalogMatch(album:string,candidates:MbCandidate[]):boolean{return candidates.some(candidate=>catalogTitleSimilarity(album,candidate)>=.8)}
function mergeResults(...results:SearchResult[]):SearchResult{const groups=new Map<string,MbCandidate>();for(const result of results)for(const candidate of result["release-groups"]){const previous=groups.get(candidate.id);if(!previous||Number(candidate.score??0)>Number(previous.score??0))groups.set(candidate.id,candidate)}return{"release-groups":[...groups.values()]}}
export function baseCatalogTitle(value:string):string{return cleanCatalogText(value).replace(/\s*[\[(][^\])]+[\])]\s*$/,"").trim()}
async function searchReleaseGroupVariants(artist:string,baseAlbum:string,localAlbum:string,entityKey:string):Promise<SearchResult>{const query=`artist:${JSON.stringify(artist)} AND releasegroup:${JSON.stringify(baseAlbum)}`,id=`release-group-variant:v4:${normalized(artist)}|${normalized(baseAlbum)}`;const found=await cachedJson("musicbrainz",id,entityKey,searchTtlDays,()=>limited(()=>fetchJson<SearchResult>(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&limit=25&fmt=json`,{headers},1))),ranked=[...found["release-groups"]].sort((a,b)=>Math.max(...candidateCatalogTitles(b).map(title=>similarity(localAlbum,title)))-Math.max(...candidateCatalogTitles(a).map(title=>similarity(localAlbum,title))));const enriched:MbCandidate[]=[];for(const candidate of ranked.slice(0,5))enriched.push(await details(candidate,entityKey));return{"release-groups":enriched}}
const editionMarker=/\b(?:advance|anniversary|bonus|box\s*set|blu[- ]?ray|cds?|deluxe|edition|expanded|hi[- ]?res|japan|legacy|maxi[- ]?single|mfsl|mix|pbthal|promo|reissue|re-issue|remaster(?:ed|is(?:e|é)e?)?|remix|rip|rsd|sacd|single|special|super\s+deluxe|surround|ultradisc|uhr|vinyl)\b|\b(?:16|24)[- /]?(?:bit|44|48|88|96|192)\b/i;
function removableEdition(value:string):boolean{const text=value.trim();return editionMarker.test(text)||/^(?:eu|europe|japan|uk|us|usa)$/i.test(text)||/^\d{4}$/.test(text)||/^(?:(?:cd|disc|disk)\s*\d+|\d+\s*cd)$/i.test(text)||/^[A-Z][A-Z& ]{1,10}[- ]?\d{3,}$/i.test(text)}
export function cleanCatalogText(value:string):string{
  let removed=false;
  let clean=value.normalize("NFKC").replace(/#{2,}/g," ").replace(/[\u2018\u2019]/g,"'").replace(/(?<=\p{L})\.(?=\p{L})/gu," ");
  clean=clean.replace(/[\[(]([^\])]+)[\])]/g,(match,inside:string)=>{if(!removableEdition(inside)&&!/^\s*\d+\s*$/.test(inside))return match;removed=true;return" "});
  clean=clean.replace(/\s*[-–—,:;]?\s*(?:disc|disk|cd)(?:\s*0*\d+)?\s*$/i,"").replace(/\s*[-–—]\s*(?:new\s+)?(?:stereo\s+)?mix(?:es)?(?:\s+remaster(?:ed)?)?\s*$/i,"").replace(/\s*[-–—]\s*(?:maxi[- ]?)?(?:single|ep)\s*$/i,"").replace(/\s+FLAC\s*$/i,"");
  if(removed)clean=clean.replace(/\s+\d+\s*$/,"");
  return clean.replace(/\.{2,}/g," ").replace(/\s+/g," ").trim();
}
export function cleanArtistName(value:string):string{const clean=cleanCatalogText(value).replace(/^the(?=[A-Z])/i,"The "),parts=clean.split(",").map(part=>part.trim()).filter(Boolean);if(parts.length!==2)return clean;if(/^the$/i.test(parts[1]))return `The ${parts[0]}`;if(!parts[0].includes(" ")&&!/[&+;/]/.test(parts[1])&&parts[1].split(/\s+/).length<=3)return `${parts[1]} ${parts[0]}`;return clean}
export function catalogTitleVariants(artist:string,album:string):string[]{const cleanArtist=cleanArtistName(artist),cleanAlbum=cleanCatalogText(album),values=new Set<string>(),add=(value:string)=>{const clean=value.replace(/^[\s\p{P}\p{S}]+/u,"").replace(/[\s\p{P}\p{S}]+$/u,"").replace(/\s+/g," ").trim();if(clean)values.add(clean)};add(cleanAlbum);let base=cleanAlbum;for(let index=0;index<3;index+=1){const next=baseCatalogTitle(base);if(!next||next===base)break;add(next);base=next}if(normalized(cleanAlbum).startsWith(`${normalized(cleanArtist)} `)){const remainder=cleanAlbum.slice(cleanArtist.length);add(remainder);add(baseCatalogTitle(remainder))}for(const value of [...values]){if(/^(?:a|an|the)\s+/i.test(value))add(value.replace(/^(?:a|an|the)\s+/i,""));if(value.split(/\s+/).length>=3&&/\s+\d{2}$/.test(value))add(value.replace(/\s+\d{2}$/,"").trim())}return[...values]}
export async function searchReleaseGroupCandidates(artist:string,album:string,entityKey:string):Promise<SearchResult>{const cleanArtist=cleanArtistName(artist),variants=catalogTitleVariants(cleanArtist,album),cleanAlbum=variants[0]??cleanCatalogText(album),exact=await searchReleaseGroups(cleanArtist,cleanAlbum,entityKey);if(hasPlausibleCatalogMatch(cleanAlbum,exact["release-groups"]))return exact;const collected=[exact];for(const variant of variants.slice(1)){const found=await searchReleaseGroupVariants(cleanArtist,variant,variant,entityKey);collected.push(found);if(hasPlausibleCatalogMatch(variant,found["release-groups"]))return mergeResults(...collected)}const looseTitle=variants.at(-1)??cleanAlbum,loose=await searchReleaseGroupsByAlbum(looseTitle,entityKey).catch(()=>({"release-groups":[]}));return mergeResults(...collected,loose)}
export async function artistWikidataId(artistId:string,entityKey:string):Promise<string|undefined>{type Artist={relations?:Array<{type:string;url?:{resource:string}}>};const value=await cachedJson("musicbrainz",`artist-links:${artistId}`,entityKey,90,()=>limited(()=>fetchJson<Artist>(`https://musicbrainz.org/ws/2/artist/${artistId}?inc=url-rels&fmt=json`,{headers},1)));return value.relations?.find(relation=>relation.type==="wikidata")?.url?.resource.split("/").pop()}
export async function resolveExactArtistId(name:string,entityKey:string):Promise<string|undefined>{type ArtistResult={artists:Array<{id:string;name:string;score:number}>};const query=`artist:${JSON.stringify(name)}`,value=await cachedJson("musicbrainz",`artist-search:${query}`,entityKey,90,()=>limited(()=>fetchJson<ArtistResult>(`https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(query)}&limit=5&fmt=json`,{headers},1)));const exact=value.artists.filter(artist=>normalized(artist.name)===normalized(name)).sort((a,b)=>b.score-a.score);if(!exact[0]||exact[0].score<90)return undefined;if(exact[1]&&exact[0].score-exact[1].score<10)return undefined;return exact[0].id}

type RecordingTitles={title:string;aliases?:Array<{name:string}>;relations?:Array<{type:string;work?:{title:string}}>};
function titlesFromRecording(value:RecordingTitles){return [...new Set([value.title,...(value.aliases??[]).map(a=>a.name),...(value.relations??[]).filter(r=>r.type==='performance').flatMap(r=>r.work?[r.work.title]:[])])];}
export function cachedRecordingTitleAliases(recordingId:string):string[]|undefined{
  const row=db().prepare("SELECT payload_json FROM evidence WHERE provider='musicbrainz' AND source_id=? AND expires_at>CURRENT_TIMESTAMP").get(`recording-titles:v1:${recordingId}`) as {payload_json:string}|undefined;
  return row?titlesFromRecording(JSON.parse(row.payload_json)):undefined;
}
export async function recordingTitleAliases(recordingId:string,entityKey:string):Promise<string[]>{
  if(!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(recordingId))return [];
  const value=await cachedJson('musicbrainz',`recording-titles:v1:${recordingId}`,entityKey,90,()=>limited(()=>fetchJson<RecordingTitles>(`https://musicbrainz.org/ws/2/recording/${recordingId}?inc=aliases+work-rels&fmt=json`,{headers},1)));
  return titlesFromRecording(value);
}
