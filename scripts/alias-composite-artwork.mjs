import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";

const root = process.env.MUSIC_ROOT ?? "/music";
const imageDir = path.join(root, ".artist-images");
const safeName = (value) => value.replaceAll("/", "_");
const key = (value) => value.normalize("NFKD").replace(/\p{M}/gu, "")
  .toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function candidates(value) {
  const variants = [];
  const feature = value.split(/\s+(?:feat\.?|featuring|with|vs\.?)\s+/i)[0]?.trim();
  if (feature && feature !== value) variants.push(feature);
  const semicolon = value.split(";")[0]?.trim();
  if (semicolon && semicolon !== value) variants.push(semicolon);
  const comma = value.split(",")[0]?.trim();
  if (comma && comma !== value) variants.push(comma);
  if (/^[^,]+,\s*[^,]+$/.test(value)) {
    const [last, first] = value.split(",").map((part) => part.trim());
    variants.unshift(`${first} ${last}`);
  }
  return [...new Set(variants)].filter(Boolean);
}

await mkdir(imageDir, { recursive: true });
const files = await readdir(imageDir);
const available = new Map(
  files.filter((name) => /\.(?:jpe?g|png|webp)$/i.test(name))
    .map((name) => [key(path.parse(name).name), path.join(imageDir, name)]),
);

const db = new Database(process.env.CURATOR_DB ?? "/app/data/curator.sqlite", { readonly: true });
const credits = new Set();
const albumArtistFallbacks = new Map();
for (const row of db.prepare("SELECT tags_json FROM files").iterate()) {
  const tags = JSON.parse(row.tags_json);
  const artists = Array.isArray(tags.artist) ? tags.artist : tags.artist ? [tags.artist] : [];
  const albumArtists = Array.isArray(tags.albumArtist) ? tags.albumArtist : tags.albumArtist ? [tags.albumArtist] : [];
  if (albumArtists.length === 1) for (const artist of artists) {
    if (typeof artist === "string" && artist.trim() && key(artist) !== key(albumArtists[0])) albumArtistFallbacks.set(artist.trim(), String(albumArtists[0]));
  }
  for (const field of ["artist", "albumArtist", "composer"]) {
    const raw = tags[field] ?? tags.extraProperties?.[field.toUpperCase()];
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const value of values) if (typeof value === "string" && value.trim()) credits.add(value.trim());
  }
}
db.close();

let written = 0;
for (const credit of credits) {
  const destination = path.join(imageDir, `${safeName(credit)}.jpg`);
  if (existsSync(destination)) continue;
  const source = candidates(credit).map((name) => available.get(key(name))).find(Boolean);
  if (!source) continue;
  await copyFile(source, destination);
  await writeFile(`${destination}.source.json`, JSON.stringify({
    kind: "verified-primary-credit-alias",
    credit,
    source: path.basename(source),
    createdAt: new Date().toISOString(),
  }, null, 2));
  available.set(key(credit), destination);
  written += 1;
}

let representativeWritten = 0;
for (const [credit, albumArtist] of albumArtistFallbacks) {
  const destination = path.join(imageDir, `${safeName(credit)}.jpg`);
  if (existsSync(destination)) continue;
  const source = available.get(key(albumArtist));
  if (!source) continue;
  await copyFile(source, destination);
  await writeFile(`${destination}.source.json`, JSON.stringify({
    kind: "verified-album-artist-representative",
    credit,
    albumArtist,
    source: path.basename(source),
    createdAt: new Date().toISOString(),
  }, null, 2));
  available.set(key(credit), destination);
  representativeWritten += 1;
}

const cachePath = "/app/data/wikidata-artwork-cache.json";
const cache = await readFile(cachePath, "utf8").then(JSON.parse).catch(() => ({}));
const profession = /musician|singer|composer|songwriter|producer|rapper|disc jockey|band|musical group|recording artist|instrumentalist/i;
const fresh = (entry) => entry && !String(entry.reason ?? "").startsWith("Error:") && Date.now() - entry.checkedAt < 90 * 24 * 60 * 60_000;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function wikidataFetch(url) {
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "MusicCurator/1.0 (personal library metadata)" } });
    if (response.status !== 429) return response;
    await wait(2_000 * (attempt + 1));
  }
  return response;
}

async function wikidataImage(credit) {
  const cacheKey = key(credit);
  if (fresh(cache[cacheKey])) return cache[cacheKey].image ?? null;
  try {
    const endpoint = new URL("https://www.wikidata.org/w/api.php");
    endpoint.search = new URLSearchParams({
      action: "wbsearchentities", search: credit, language: "en", uselang: "en",
      type: "item", limit: "8", format: "json", origin: "*",
    }).toString();
    const response = await wikidataFetch(endpoint);
    if (!response.ok) throw new Error(`Wikidata ${response.status}`);
    const data = await response.json();
    const match = data.search?.find((item) => key(item.label ?? "") === cacheKey && profession.test(item.description ?? ""));
    if (!match) { cache[cacheKey] = { checkedAt: Date.now(), image: null, reason: "no exact music-person match" }; return null; }
    await wait(750);
    const entityResponse = await wikidataFetch(`https://www.wikidata.org/wiki/Special:EntityData/${match.id}.json`);
    if (!entityResponse.ok) throw new Error(`Wikidata entity ${entityResponse.status}`);
    const entity = (await entityResponse.json()).entities?.[match.id];
    const filename = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (!filename) { cache[cacheKey] = { checkedAt: Date.now(), image: null, reason: "no Commons image" }; return null; }
    const image = {
      url: `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(filename)}?width=1200`,
      sourcePage: `https://www.wikidata.org/wiki/${match.id}`,
      entity: match.id,
      evidence: `${match.label}: ${match.description}`,
    };
    cache[cacheKey] = { checkedAt: Date.now(), image };
    return image;
  } catch (error) {
    cache[cacheKey] = { checkedAt: Date.now(), image: null, reason: String(error) };
    return null;
  }
}

let commonsWritten = 0;
const identityQuality = (credit) => {
  if (/see subsong|traditional|various|[<>¤]{2}|\bva\b/i.test(credit)) return 0;
  if (/\b(?:feat\.?|featuring|with|vs\.?)\b|[;&]/i.test(credit)) return 1;
  if (/^[A-Z]\.?(?:\s+[A-Z]\.?)?\s+\p{L}+$/u.test(credit)) return 2;
  return credit.trim().split(/\s+/).length >= 2 ? 4 : 3;
};
const unresolved = [...credits]
  .filter((credit) => {
    const cached = cache[key(credit)];
    return !existsSync(path.join(imageDir, `${safeName(credit)}.jpg`)) && identityQuality(credit) > 0 && (!fresh(cached) || cached.image);
  })
  .sort((a, b) => identityQuality(b) - identityQuality(a) || a.localeCompare(b))
  .slice(0, 30);
let cursor = 0;
async function commonsWorker() {
  while (cursor < unresolved.length) {
    const credit = unresolved[cursor++];
    const candidate = await wikidataImage(credit);
    if (!candidate) continue;
    try {
      await wait(750);
      const response = await fetch(candidate.url, { signal: AbortSignal.timeout(25_000), headers: { "User-Agent": "MusicCurator/1.0 (personal library metadata)" } });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.startsWith("image/")) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 20 * 1024 * 1024) continue;
      const pipeline = sharp(bytes).rotate();
      const metadata = await pipeline.metadata();
      if (Math.max(metadata.width ?? 0, metadata.height ?? 0) < 600) continue;
      const destination = path.join(imageDir, `${safeName(credit)}.jpg`);
      await pipeline.resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).flatten({ background: "#f4efe3" }).jpeg({ quality: 90 }).toFile(destination);
      await writeFile(`${destination}.source.json`, JSON.stringify({ kind: "wikidata-commons-exact", credit, ...candidate, retrievedAt: new Date().toISOString() }, null, 2));
      available.set(key(credit), destination);
      commonsWritten += 1;
    } catch { /* A failed image remains available for a later policy cycle. */ }
    await wait(750);
  }
}
await commonsWorker();
await writeFile(cachePath, JSON.stringify(cache));

console.log(JSON.stringify({ compositeArtworkAliasesWritten: written, albumArtistRepresentativesWritten: representativeWritten, wikimediaCommonsWritten: commonsWritten, checked: unresolved.length }));
