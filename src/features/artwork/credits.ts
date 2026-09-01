import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, extname, relative } from "node:path";
import { config, versions } from "@/config";
import { db } from "@/features/db/client";
import { normalized } from "@/features/scanner/normalize";
import { splitArtistCredits, splitComposerCredits } from "@/features/scanner/credits";
import { resolveExactArtistId } from "@/features/sources/musicbrainz";
import { centralArtistPath,ensureArtistMbidAlias,ensureNamedArtistImage } from "./manager";

type Row = { artist_name: string; album_name: string; path: string; tags_json: string };
type Credit = { name: string; roles: Set<string>; contexts: Set<string>; seeds: Set<string> };

function values(value: unknown): string[] {
  const input = Array.isArray(value) ? value : value ? [value] : [];
  return input.flatMap((item) => String(item).split(/\s*;\s*/)).map((item) => item.trim()).filter(Boolean);
}

function add(map: Map<string, Credit>, name: string, role: string, context: string, seed?: string): void {
  if (!name || name === "Various Artists") return;
  const key = normalized(name), credit = map.get(key) ?? { name, roles: new Set(), contexts: new Set(), seeds: new Set() };
  credit.roles.add(role); credit.contexts.add(context); if (seed) credit.seeds.add(seed); map.set(key, credit);
}

type Coverage={present:number;total:number;missing:number};
function localCreditAlias(name:string,target:string):string|undefined{
  const folder=dirname(target),raw=normalized(name).split(" ").filter(Boolean);if(raw.length<2)return;
  let files:string[]=[];try{files=readdirSync(folder)}catch{return}
  const candidates=files.filter(file=>/\.(?:jpe?g|png|webp)$/i.test(file)).filter(file=>{
    const candidate=normalized(basename(file,extname(file))),words=candidate.split(" ").filter(Boolean);
    if(candidate===normalized(name))return true;
    return raw.some(word=>word.length===1)&&words.length===raw.length&&raw.every((word,index)=>word.length===1?words[index]?.startsWith(word):words[index]===word);
  }).map(file=>`${folder}/${file}`).filter(file=>file!==target);
  return candidates.length===1?candidates[0]:undefined;
}
export async function ensureCreditImages(limit = 24): Promise<{ total: number; missing: number; processed: number; found: number;coverage:Record<"artist"|"albumArtist"|"composer",Coverage> }> {
  const rows = db().prepare("SELECT artist_name,album_name,path,tags_json FROM files ORDER BY id").all() as Row[], credits = new Map<string, Credit>();
  for (const row of rows) {
    const tags = JSON.parse(row.tags_json) as Record<string, unknown>, context = `${row.artist_name} - ${row.album_name}`;
    const artistRoot = `${config.MUSIC_ROOT}/${relative(config.MUSIC_ROOT, row.path).split("/")[0]}`;
    add(credits, row.artist_name, "album artist", context, `${artistRoot}/artist.jpg`);
    for (const name of splitArtistCredits(tags.albumArtist)) add(credits, name, "album artist", context, normalized(name) === normalized(row.artist_name) ? `${artistRoot}/artist.jpg` : undefined);
    for (const name of splitArtistCredits(tags.artist)) add(credits, name, "track artist", context, normalized(name) === normalized(row.artist_name) ? `${artistRoot}/artist.jpg` : undefined);
    for (const name of splitComposerCredits(tags.composer ?? tags.COMPOSER)) add(credits, name, "composer", context);
  }
  for(const credit of credits.values()){const target=centralArtistPath(credit.name);if(!target||existsSync(target))continue;const alias=localCreditAlias(credit.name,target);if(alias)credit.seeds.add(alias)}
  const missing = [...credits].filter(([, credit]) => { const target = centralArtistPath(credit.name); if (!target || existsSync(target)) return false; const key = `credit:${normalized(credit.name)}`; const attempts = db().prepare("SELECT count(*) count FROM artwork_attempts WHERE entity_key=? AND kind='artist' AND policy_version=?").get(key, versions.artwork) as { count: number }; return attempts.count < 2; });
  let processed = 0, found = 0;
  const local = missing.filter(([, credit]) => [...credit.seeds].some(existsSync)).slice(0, 64), localKeys = new Set(local.map(([key]) => key));
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { for (;;) {
    const item = local[next++]; if (!item) return; const [key, credit] = item, target = centralArtistPath(credit.name); if (!target) continue;
    if (await ensureNamedArtistImage({ entityKey: `credit:${key}`, artistName: credit.name, target, seedPaths: [...credit.seeds] })) found++;
    processed++;
  } }));
  const remote=missing.filter(([key])=>!localKeys.has(key)).slice(0,200),hard:Array<[string,Credit]>=[];next=0;
  await Promise.all(Array.from({length:6},async()=>{for(;;){const item=remote[next++];if(!item)return;const[key,credit]=item,target=centralArtistPath(credit.name);if(!target)continue;const entityKey=`credit:${key}`,image=await ensureNamedArtistImage({entityKey,artistName:credit.name,target,seedPaths:[...credit.seeds],allowWeb:false});if(image)found++;else hard.push(item);processed++}}));
  for(const[key,credit]of hard.slice(0,Math.min(limit,24))){const target=centralArtistPath(credit.name);if(!target)continue;const entityKey=`credit:${key}`,context=`${[...credit.roles].join(", ")} credits on ${[...credit.contexts].slice(0,4).join("; ")}`,artistId=await resolveExactArtistId(credit.name,entityKey).catch(()=>undefined),image=await ensureNamedArtistImage({entityKey,artistName:credit.name,artistId,target,seedPaths:[...credit.seeds],context});if(image){found++;if(artistId)await ensureArtistMbidAlias(artistId,image)}processed++}
  function roleCoverage(role:string):Coverage{const selected=[...credits.values()].filter(credit=>credit.roles.has(role)),present=selected.filter(credit=>{const target=centralArtistPath(credit.name);return Boolean(target&&existsSync(target))}).length;return{present,total:selected.length,missing:selected.length-present}}
  const unresolved=[...credits.values()].filter(credit=>{const target=centralArtistPath(credit.name);return !target||!existsSync(target)}).length;
  return { total: credits.size, missing: unresolved, processed, found,coverage:{artist:roleCoverage("track artist"),albumArtist:roleCoverage("album artist"),composer:roleCoverage("composer")} };
}
