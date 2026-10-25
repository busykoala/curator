import { config } from "@/config";
import { db, stateGet, stateSet } from "@/features/db/client";
import { artistReleases, releases, reserveSearch, SearchDeferred } from "./lidarr";
import type { Release } from "./matching";
import { releaseInfoHash } from './qbittorrent';
import { configuredRequestLimits,type LimitField } from './source-limits';

const cache = new Map<string, { expires: number; work: Promise<Release[]> }>();
const sourceWork = new Map<number, Promise<unknown>>();
export function clearDiscoveryCache() { cache.clear(); sources = undefined; }
export function hasArtistCache(id: number) {
  return [`artist:${id}`, `direct-artist:${id}`].some(key => (cache.get(key)?.expires ?? 0) > Date.now());
}
export async function cachedArtistCandidates(id: number) {
  const entries = [`direct-artist:${id}`, `artist:${id}`].flatMap(key => {
    const saved = cache.get(key);
    return saved && saved.expires > Date.now() ? [saved.work] : [];
  });
  return (await Promise.all(entries)).flat();
}
async function cached(key: string, work: () => Promise<Release[]>) {
  const saved = cache.get(key);
  if (saved && saved.expires > Date.now()) return saved.work;
  if (cache.size > 128) for (const [old, entry] of cache) if (entry.expires < Date.now()) cache.delete(old);
  const promise = work();
  cache.set(key, { expires: Date.now() + 10 * 60_000, work: promise });
  try { return await promise; } catch (error) { cache.delete(key); throw error; }
}
function recordSearch(name: string, indexerId: number | null, event: string, started: number, detail: unknown) {
  db().prepare("INSERT INTO source_outcomes(indexer_id,indexer_name,event,latency_ms,detail_json) VALUES(?,?,?,?,?)")
    .run(indexerId, name, event, Date.now() - started, JSON.stringify(detail));
}
async function nativeSearch(kind: string, id: number, work: () => Promise<Release[]>) {
  await reserveSearch(kind);
  const started = Date.now();
  try {
    const items = await work();
    recordSearch('Lidarr', null, 'search', started, { kind, id, results: items.length });
    return items;
  } catch (error) {
    recordSearch('Lidarr', null, 'search_failure', started, { kind, id, reason: String(error) });
    throw error;
  }
}
export const nativeAlbum = (id: number) => cached(`album:${id}`, () => nativeSearch('album', id, () => releases(id)));
export const nativeArtist = (id: number) => cached(`artist:${id}`, () => nativeSearch('artist', id, () => artistReleases(id)));
export const directArtist = (id: number, artist: string) => cached(`direct-artist:${id}`, () => directCandidates(artist, ''));

type Category = { id: number; subCategories?: Category[] };
type Indexer = { id: number; name: string; enable: boolean;protocol?:string;fields?:LimitField[]; capabilities?: { categories?: Category[];searchParams?:string[] } };
let sources: { expires: number; rows: Indexer[] } | undefined;
function categoryIds(rows:Category[]):number[]{return rows.flatMap(row=>[row.id,...categoryIds(row.subCategories??[])])}
export function searchCategories(source: Indexer) {
  const categories = categoryIds(source.capabilities?.categories ?? []);
  // Generic indexers classify music as Other. An unsupported music category
  // makes Prowlarr return an immediate empty response without querying them.
  return categories.some(id => id >= 3000 && id < 4000) ? [3000] : [];
}
async function prowlarr<T>(path: string): Promise<T> {
  const r = await fetch(`${config.PROWLARR_URL}/api/v1${path}`, {
    headers: { 'X-Api-Key': config.PROWLARR_API_KEY }, signal: AbortSignal.timeout(45_000),
  });
  if (r.status === 429) {
    const header = r.headers.get('retry-after') ?? '';
    const seconds = Number(header), date = Date.parse(header);
    const retry = seconds > 0 ? Date.now() + seconds * 1000 : Number.isFinite(date) ? date : Date.now() + 900_000;
    throw new SearchDeferred(new Date(retry).toISOString(), 'Prowlarr rate limited');
  }
  if (!r.ok) {
    const text = await r.text();
    if (r.status === 400 && /all selected indexers being unavailable/i.test(text))
      throw new SearchDeferred(new Date(Date.now() + 30 * 60_000).toISOString(), 'Indexer temporarily unavailable');
    throw Error(`Prowlarr search failed (${r.status})`);
  }
  return r.json();
}
async function serializedSource<T>(id: number, work: () => Promise<T>): Promise<T> {
  const previous = sourceWork.get(id) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  sourceWork.set(id, next);
  try { return await next; } finally { if (sourceWork.get(id) === next) sourceWork.delete(id); }
}
export function directRelease(report: Release, sourceName: string, observedAt = new Date().toISOString()): Release {
  const title = String(report.title ?? ''), hash = releaseInfoHash(report);
  const quality = /\bflac\b/i.test(title) ? 'FLAC' : /\bmp3\b.*\b320\b|\b320\s*kbps\b/i.test(title) ? 'MP3-320' : /\bmp3\b.*\bv0\b/i.test(title) ? 'MP3-VBR-V0' : 'Unknown';
  // Prowlarr can rewrite even its magnetUrl field to an HTTP proxy URL.
  // Inspect the actual protocol; an exact info hash still identifies a DHT
  // magnet independently of that proxy. Keep genuine HTTP-only routes as HTTP.
  const rawMagnet=String(report.magnetUrl??'');
  let magnetUrl=/^magnet:\?/i.test(rawMagnet)?rawMagnet:undefined;
  const downloadUrl=report.downloadUrl??(/^https?:\/\//i.test(rawMagnet)?rawMagnet:undefined);
  if(!magnetUrl){
    if(String(downloadUrl??'').startsWith('magnet:?'))magnetUrl=String(downloadUrl);
    else if(String(report.guid??'').startsWith('magnet:?'))magnetUrl=String(report.guid);
    else if(hash)magnetUrl=`magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`;
  }
  const hasDate=typeof report.publishDate==='string'&&Number.isFinite(Date.parse(report.publishDate));
  // Hash-only indexers omit both download links and publication dates. Use the
  // verified hash as the magnet and record observation time explicitly; this
  // timestamp is transport metadata, never the library album's release date.
  return {...report,magnetUrl,...(downloadUrl?{downloadUrl}:{}),publishDate:hasDate?report.publishDate:observedAt,
    publicationDateSource:hasDate?'indexer':'observed',quality:{quality:{name:quality}},indexer:`${sourceName} (Prowlarr)`,direct:true};
}
async function sourceCandidates(source: Indexer, query: string) {
  return cached(`direct:${source.id}:${query}`, () => serializedSource(source.id, async () => {
    const until = Number(stateGet(`acquisition_source_wait:${source.id}`, '0'));
    if (until > Date.now()) {
      // Serialize the two workers across ordinary request spacing. A provider
      // outage or quota wait is deferred instead of occupying a worker.
      if (until - Date.now() > 5000) throw new SearchDeferred(new Date(until).toISOString(), 'Indexer cooling down');
      await new Promise(resolve => setTimeout(resolve, Math.max(0, until - Date.now())));
    }
    const limits=configuredRequestLimits(source.fields);
    await reserveSearch('direct', [source.id],limits);
    const spacing=Math.max(5000,limits.hourly?Math.ceil(3600_000/limits.hourly):0,limits.daily?Math.ceil(86400_000/limits.daily):0);
    stateSet(`acquisition_source_wait:${source.id}`, String(Date.now() + spacing));
    const params = new URLSearchParams({ query, type: 'search', indexerIds: String(source.id), limit: '100' });
    const categories = searchCategories(source);
    if (categories.length) params.set('categories', categories.join(','));
    const started = Date.now();
    try {
      const reports = await prowlarr<Release[]>(`/search?${params}`);
      recordSearch(source.name, source.id, 'search', started, { query, categories, results: reports.length });
      stateSet(`acquisition_source_error:${source.id}`, '');
      stateSet(`acquisition_source_status:${source.id}`, JSON.stringify({ at: new Date().toISOString(), results: reports.length }));
      return reports.map(r => directRelease(r, source.name));
    } catch (error) {
      recordSearch(source.name, source.id, 'search_failure', started, { query, reason: String(error) });
      throw error;
    }
  }));
}
export function discoverySearchQuery(artist:string,title:string){
  // Nicknames and accents can overconstrain general indexers. This broadens
  // retrieval only; the original canonical artist still governs acceptance.
  const name=artist.replace(/[“"][^”"]+[”"]/g,' ').replace(/\s+/g,' ').trim()||artist;
  return `${/^various artists$/i.test(artist)?'':name} ${title.replace(/\([^)]*\)|\[[^\]]*\]/g,' ')}`
    .normalize('NFKD').replace(/\p{M}/gu,'').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
}
export async function directCandidates(artist: string, title: string, remainingSources=false, attemptedSources?:Set<number>) {
  if (!sources || sources.expires < Date.now()) sources = { expires: Date.now() + 300_000, rows: await prowlarr<Indexer[]>('/indexer') };
  const preferred = ['TorrentsCSV', 'Knaben', 'LimeTorrents', 'Nyaa.si', 'The Pirate Bay', 'TorrentKitty', 'TorrentDownload'];
  const rank=(name:string)=>preferred.includes(name)?preferred.indexOf(name):preferred.length;
  const rows = sources.rows.filter(s => s.enable && (preferred.includes(s.name)||
    (s.protocol==='torrent'&&s.capabilities?.searchParams?.includes('q')&&categoryIds(s.capabilities.categories??[]).some(id=>(id>=3000&&id<4000)||id===8000))))
    .sort((a, b) => rank(a.name)-rank(b.name));
  // Broaden the query, never the identity acceptance criteria.
  const query=discoverySearchQuery(artist,title);
  if (!query) return [];
  const candidates=rows.filter(source=>!attemptedSources?.has(source.id)&&(!remainingSources||(cache.get(`direct:${source.id}:${query}`)?.expires??0)<=Date.now()));
  const result: Release[] = [], errors: unknown[] = [];
  let completed = 0;
  for (const source of candidates) {
    attemptedSources?.add(source.id);
    try {
      result.push(...await sourceCandidates(source, query));
      if (++completed >= 2) break;
    } catch (error) {
      errors.push(error);
      // Do not replace an informative provider failure with a routine cooldown.
      if (!(error instanceof SearchDeferred) || error.message !== 'Indexer cooling down') {
        const retry = error instanceof SearchDeferred ? Date.parse(error.retryAt) : Date.now() + 5 * 60_000;
        stateSet(`acquisition_source_wait:${source.id}`, String(retry));
        stateSet(`acquisition_source_error:${source.id}`, JSON.stringify({ message: String(error), retryAt: new Date(retry).toISOString() }));
      }
    }
  }
  if (!completed && errors.length) throw errors[0];
  if (!rows.length) throw new SearchDeferred(new Date(Date.now() + 30 * 60_000).toISOString(), 'No enabled discovery providers');
  return result;
}
