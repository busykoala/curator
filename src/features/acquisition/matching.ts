import {createHash} from 'node:crypto';
export type CatalogAlbum = {
  id: number; artistId: number; title: string; monitored: boolean;anyReleaseOk?:boolean;
  releaseDate?: string; albumType?:string; secondaryTypes?: string[]; disambiguation?: string;
  releases?: Array<{ id?:number;title: string;disambiguation?:string;trackCount?:number;mediumCount?:number;monitored?:boolean }>;
  statistics?: { trackFileCount?: number; percentOfTracks?: number };
};
export type Release = Record<string, unknown>;

export function decodeTitle(value: string) {
  return value.replace(/&amp;/gi, "&").replace(/&(?:apos|#39);/gi, "'")
    .replace(/&quot;/gi, '"').replace(/&iexcl;/gi, "¡").replace(/&(?:ndash|mdash);/gi, "-")
    .replace(/&#(\d+);/g, (_, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : "");
}
const words = (s: string) => decodeTitle(s).normalize("NFKD").replace(/\p{M}/gu, "")
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
const stop = new Set(["the", "a", "an", "and", "of"]);
const technicalDescriptors=new Set(('remaster remastered deluxe expanded anniversary edition version original mono stereo cd lp vinyl uhqr japan japanese uk us eu digital flac alac mp3 bit kbps khz hz studio masters rock pop jazz reggae blues folk classical metal electronic elettronica alternative indie dance soul rnb country').split(' '));
const significant = (s: string) => words(s).filter(w => !stop.has(w));
const key = (s: string) => significant(s).join(" ");
export function needsNativeIdentity(album: CatalogAlbum, artist: string) {
  const artistSet=new Set(significant(artist));
  const meaningful=significant(album.title).filter(w=>!artistSet.has(w));
  const generic=new Set(['best','greatest','hits','collection','ultimate','very','vol','volumes']);
  return !meaningful.some(w=>!generic.has(w)&&!/^\d+$/.test(w));
}
const number = (s: string) => (({one:"1",two:"2",three:"3",i:"1",ii:"2",iii:"3",iv:"4",v:"5"} as Record<string,string>)[s] ?? s);
function volumes(s: string) {
  // Years, bit depths and uploader numbers aren't album volume numbers.
  const match = /(?:vol(?:ume)?s?\.?|hits)\s+((?:(?:one|two|three|[ivx]+|\d{1,2})(?:\s*(?:,|&|and|\+|\/)\s*|\s+|$))+)/i.exec(decodeTitle(s));
  return match ? words(match[1]).filter(w => w !== "and").map(number).sort().join(",") : "";
}
export function releaseQuality(item: Release) {
  const current=String((item.quality as {quality?: {name?: string}})?.quality?.name ?? "");
  if(current!=='FLAC')return current;
  const evidence=[String(item.title??'')];
  // Some indexers truncate their displayed title but preserve the full name
  // in the magnet's dn field or source slug. Only explicit bit depth counts.
  for(const value of [item.guid,item.magnetUrl])if(typeof value==='string')try{
    const url=new URL(decodeTitle(value).replace(/^\d+_/,''));
    evidence.push(decodeURIComponent(url.searchParams.get('dn')??url.pathname));
  }catch{/* No additional format evidence. */}
  return evidence.some(s=>/\bflac[\s_\-[\]()]*24\b|\b24[\s-]*bit\b/i.test(s))?'FLAC 24bit':current;
}
export function needsQualityRepair(item:Release){return releaseQuality(item)!==String((item.quality as {quality?:{name?:string}})?.quality?.name??'')}
export function allowedQuality(item: Release, fallback: boolean) {
  return /^(FLAC(?: 24bit)?)$/i.test(releaseQuality(item)) ||
    (fallback && /^(MP3-320|MP3-VBR-V0)$/i.test(releaseQuality(item)));
}
export function parserRejections(item: Release) {
  const reasons = item.rejections as string[] | undefined;
  return Boolean(reasons?.length) && reasons!.every(r =>
    /^(Unable to parse release|Unable to parse albums from release name|Unknown Artist)$/.test(r));
}

/** Conservative title evidence, followed by Lidarr's own exact ID resolution. */
export function matchesAlbum(item: Release, album: CatalogAlbum, artist: string, parsed?: {artist?:{id:number};albums?:Array<{id:number}>}) {
  const raw = decodeTitle(String(item.title ?? "")), titleWords = words(raw), artistWords = significant(artist);
  const verified=parsed?.artist?.id===album.artistId&&parsed.albums?.length===1&&parsed.albums[0].id===album.id;
  // Never mistake e.g. Delores Keane for Keane. Collaborative credits may follow.
  const prefix = significant(raw).slice(0, artistWords.length).join(" ");
  if (!artistWords.length || (prefix !== artistWords.join(" ")&&!verified)) return false;
  // Some catalogue groups reuse a studio album's name for a multi-album box.
  // The shared title alone cannot establish that collection's identity.
  if(/\bbox\s*set\b/i.test(album.disambiguation??'')&&!/\bbox\s*set\b|\bdisk union\b/i.test(raw)){
    const counts=(album.releases??[]).map(r=>r.mediumCount??0).filter(n=>n>1);
    if(!counts.some(n=>new RegExp(`\\b${n}\\s*(?:x\\s*)?(?:cd|discs?|lp)\\b`,'i').test(raw)))return false;
  }
  const metadata = `${album.title} ${(album.secondaryTypes ?? []).join(" ")}`;
  // An abbreviated catalogue alias must not erase the recording's identity.
  // A studio American Idiot cannot satisfy the Broadway cast release even if
  // the latter has an alias named simply American Idiot.
  for(const [expected,actual] of [[/\bbroadway\b/i,/\bbroadway\b/i],[/\bcast\s+recording\b/i,/\bcast\b/i],[/\bspoken\s+word\b/i,/\bspoken\s+word\b/i]])
    if(expected.test(album.title)&&!actual.test(raw))return false;
  const knownTitles=[album.title,album.disambiguation??'',...(album.releases??[]).flatMap(r=>[r.title,r.disambiguation??''])];
  const technical=new Set([...technicalDescriptors,...'album plus bonus track tracks limited sacd eac web mqa dsd'.split(' ')]);
  for(const part of raw.matchAll(/\(([^)]*)\)/g)){
    const content=key(part[1]);
    if(knownTitles.some(t=>key(t).includes(content)))continue;
    // Parentheses often carry a different release identity, not harmless
    // formatting. Only known edition/format/year descriptors can be discarded.
    if(significant(part[1]).some(w=>!technical.has(w)&&!/^\d+(?:st|nd|rd|th|bit|kbps|khz)?$/.test(w)))return false;
  }
  for (const variant of ["instrumental", "karaoke", "tribute", "live", "remix", "acoustic", "meditation"]){
    const suffix=variant==='remix'?'(?:es|ed)?':'s?';
    if (new RegExp(`\\b${variant}${suffix}\\b`, "i").test(raw) && !new RegExp(`\\b${variant}${suffix}\\b`, "i").test(metadata)) return false;
  }
  if(/\bEP\b/.test(raw)&&album.albumType?.toLowerCase()!=='ep'&&!/\bEP\b/.test(album.title))return false;
  if (/\b(discography|complete collection|complete albums|reimagined|revisited|return to)\b/i.test(raw)) return false;
  if (/\b(BDRip|HDRip|HDTV|720p|1080p|2160p)\b|\.(mkv|mp4|avi)\b/i.test(raw)) return false;
  for (const range of raw.matchAll(/\b((?:19|20)\d{2})\s*(?:to|[-–—])\s*((?:19|20)\d{2})\b/gi))
    if (!words(album.title).join("").includes(range[1] + range[2])) return false;
  const expectedVolumes = volumes(album.title), actualVolumes = volumes(raw);
  if (expectedVolumes && actualVolumes && expectedVolumes !== actualVolumes) return false;
  const artistSet = new Set(artistWords);
  // Generic compilation names and numeric titles require exact native mapping;
  // don't repair them using a substring such as "Best of Bob Marley" in Legend.
  if (needsNativeIdentity(album,artist)) {
    if (!verified&&(key(String(item.albumTitle ?? "")) !== key(album.title) || item.rejected)) return false;
    const year = album.releaseDate?.slice(0, 4);
    if (!year || !titleWords.includes(year)) return false;
  }
  if (key(album.title) === key(artist) && (!album.releaseDate || !titleWords.includes(album.releaseDate.slice(0, 4)))) return false;
  const rawKey = " " + key(raw) + " ";
  return [album.title, ...(album.releases ?? []).map(r => r.title)].some(alias => {
    if (expectedVolumes && volumes(alias) !== expectedVolumes) return false;
    const required = significant(alias).filter(w => !artistSet.has(w));
    if (!required.length) return rawKey.includes(" " + key(alias) + " ");
    return required.every(w => titleWords.includes(w)) &&
      // At least one distinctive album phrase must remain contiguous.
      (rawKey.includes(" " + key(alias) + " ") || required.length >= 3 || required.join(" ") === "s m2");
  });
}

export function repairedTitle(item: Release, album: CatalogAlbum, artist: string) {
  const quality = releaseQuality(item);
  // Recording variants have already been checked against metadata. The original
  // title remains in the audit record; the download URL/hash is never changed.
  // Lidarr treats digit runs in a release-group suffix as an overriding year.
  // Encode every hexadecimal nibble as a letter, preserving all48 identity
  // bits while keeping the album's real year visible to the native parser.
  const source=createHash('sha256').update(String(item.guid??item.downloadUrl??item.title)).digest('hex').slice(0,12)
    .replace(/[0-9a-f]/g,n=>String.fromCharCode(97+parseInt(n,16)));
  return `${artist} - ${album.title} ${album.releaseDate ? `(${album.releaseDate.slice(0, 4)}) ` : ""}[${quality}] [src-${source}]`;
}

/** Do not turn an unparseable compilation or longer album name into this one. */
export function conflictingAlbum(item:Release,album:CatalogAlbum,catalog:CatalogAlbum[],artist:string){
  const artistPrefix=key(artist),raw=key(String(item.title??'').replace(/\([^)]*\)/g,' '));
  const title=' '+(raw.startsWith(artistPrefix)?raw.slice(artistPrefix.length).trim():raw)+' ';
  const expected=[album.title,...(album.releases??[]).map(r=>r.title)].map(key);
  return catalog.some(other=>{
    const phrase=key(other.title);
    // A genre or edition annotation is not evidence of a second recording,
    // even when that artist also has a compilation called e.g. "Reggae".
    if(significant(other.title).every(w=>technicalDescriptors.has(w)||/^\d+$/.test(w)))return false;
    return other.id!==album.id&&phrase.length>=5&&!expected.some(t=>(' '+t+' ').includes(' '+phrase+' '))&&title.includes(' '+phrase+' ');
  });
}
