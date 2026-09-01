import Database from "better-sqlite3";
import sharp from "sharp";
import { basename, dirname, join, relative, resolve } from "node:path";
import { constants, copyFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const db = new Database(process.env.CURATOR_DB_PATH || "/app/data/curator.sqlite");
db.pragma("busy_timeout = 5000");
const music = process.env.MUSIC_ROOT || "/music";
const albumLimit = Number(process.env.ARTWORK_ALBUM_LIMIT || 60);
const artistLimit = Number(process.env.ARTWORK_ARTIST_LIMIT || 120);
const artworkWorkers = Math.max(1, Math.min(8, Number(process.env.ARTWORK_WORKERS || 4)));
const skipMusicBrainz = process.env.ARTWORK_SKIP_MUSICBRAINZ === "true";
const retryMissing = process.env.ARTWORK_RETRY_MISSING === "true";
const artworkPolicyVersion = Number(process.env.ARTWORK_POLICY_VERSION || 1);

const text = value => Array.isArray(value) ? value[0] || "" : String(value || "");
const values = value => (Array.isArray(value) ? value : value ? [value] : []).map(String);
const norm = value => text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .replace(/&/g, " and ").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const cleanAlbum = value => text(value).replace(/[,\s]*(?:\(|\[)?(?:cd|disc)\s*\d+(?:\)|\])?$/i, "")
  .replace(/\s+\(\d+\)$/i, "").trim();
const similarity = (a, b) => {
  const left = new Set(norm(a).split(" ").filter(Boolean));
  const right = new Set(norm(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  if (norm(a) === norm(b)) return 1;
  const common = [...left].filter(x => right.has(x)).length;
  return common / (left.size + right.size - common);
};
const exists = path => stat(path).then(x => x.isFile() && x.size > 10_000).catch(() => false);
const artistPath = name => join(music,".artist-images",`${name.replaceAll("/","_")}.jpg`);
const pause = ms => new Promise(done => setTimeout(done, ms));
let musicBrainzQueue = Promise.resolve();

async function fetchJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "MusicCurator/1.0" } });
    if (response.ok) return response.json();
    if (response.status !== 429) throw new Error(`${response.status} ${url}`);
    await pause(750 * (attempt + 1));
  }
  throw new Error(`rate limited: ${url}`);
}

function musicBrainzJson(path, params = {}) {
  const task = musicBrainzQueue.then(async () => {
    await pause(1100);
    const query = new URLSearchParams({ ...params, fmt: "json" });
    return fetchJson(`https://musicbrainz.org/ws/2/${path}?${query}`);
  });
  musicBrainzQueue = task.catch(() => {});
  return task;
}

async function persist(url, destination, entityKey, kind, provider, confidence) {
  const folder = dirname(destination), prefix = `${basename(destination)}.backfill-`;
  for (const entry of await readdir(folder).catch(() => [])) if (entry.startsWith(prefix)) await unlink(join(folder, entry)).catch(() => {});
  if (await exists(destination)) return "existing";
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
  if (!response.ok || !String(response.headers.get("content-type")).startsWith("image/")) return "invalid-response";
  const size = Number(response.headers.get("content-length") || 0);
  if (size > 20_000_000) return "too-large";
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 20_000_000) return "too-large";
  const image = sharp(bytes, { failOn: "error" });
  const metadata = await image.metadata();
  if (Math.max(metadata.width || 0, metadata.height || 0) < 300) return "too-small";
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.backfill-${randomUUID()}`;
  await image.rotate().flatten({ background: "#fff" }).resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90, progressive: true }).toFile(temporary);
  try { await copyFile(temporary, destination, constants.COPYFILE_EXCL); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  finally { await unlink(temporary).catch(() => {}); }
  const final = await sharp(destination).metadata();
  db.prepare(`INSERT INTO artwork(entity_key,kind,path,provider,source_url,license,width,height,updated_at)
    VALUES(?,?,?,?,?,'unknown-personal-use',?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(entity_key) DO UPDATE SET path=excluded.path,provider=excluded.provider,source_url=excluded.source_url,
    width=excluded.width,height=excluded.height,updated_at=CURRENT_TIMESTAMP`)
    .run(entityKey, kind, destination, provider, url, final.width || 0, final.height || 0);
  if (kind === "cover") db.prepare("UPDATE issues SET status='resolved',updated_at=CURRENT_TIMESTAMP WHERE album_key=? AND code='missing_album_artwork'").run(entityKey);
  return "written";
}

function albumFolder(path) {
  const parts = relative(music, path).split("/");
  return parts.length >= 3 ? resolve(music, parts[0], parts[1]) : dirname(path);
}

async function albumCandidate(row) {
  const album = cleanAlbum(row.album_name);
  const year = Number(String(row.date || row.year || "").slice(0, 4));
  const term = encodeURIComponent(`${row.artist_name} ${album}`);
  const [brainz, apple, deezer] = await Promise.allSettled([
    musicBrainzJson("release-group/", { query: `artist:\"${row.artist_name}\" AND releasegroup:\"${album}\"`, limit: "8" }),
    fetchJson(`https://itunes.apple.com/search?media=music&entity=album&limit=12&term=${term}`),
    fetchJson(`https://api.deezer.com/search/album?limit=12&q=${term}`),
  ]);
  const candidates = [];
  if (brainz.status === "fulfilled") for (const item of brainz.value["release-groups"] || []) candidates.push({
    artist: (item["artist-credit"] || []).map(x => x.name).join(" & "), album: item.title,
    year: Number(String(item["first-release-date"] || "").slice(0, 4)),
    url: `https://coverartarchive.org/release-group/${item.id}/front-1200`, provider: "cover-art-archive",
  });
  if (apple.status === "fulfilled") for (const item of apple.value.results || []) candidates.push({
    artist: item.artistName, album: item.collectionName, year: Number(String(item.releaseDate || "").slice(0, 4)),
    url: item.artworkUrl100?.replace(/100x100[^/]*\.jpg$/, "1200x1200bb.jpg"), provider: "apple-search",
  });
  if (deezer.status === "fulfilled") for (const item of deezer.value.data || []) candidates.push({
    artist: item.artist?.name, album: item.title, year: 0, url: item.cover_xl || item.cover_big, provider: "deezer-search",
  });
  return candidates.map(item => ({ ...item,
    score: similarity(row.artist_name, item.artist) * 0.48 + similarity(album, cleanAlbum(item.album)) * 0.47 + (year && item.year && year === item.year ? 0.05 : 0),
  })).filter(item => item.url && similarity(row.artist_name, item.artist) >= 0.72 && similarity(album, cleanAlbum(item.album)) >= 0.58)
    .sort((a, b) => b.score - a.score)[0];
}

async function backfillAlbums() {
  const rows = db.prepare(`SELECT i.album_key,f.path,f.artist_name,f.album_name,json_extract(f.tags_json,'$.date') date,
    json_extract(f.tags_json,'$.year') year FROM issues i JOIN files f ON f.album_key=i.album_key
    WHERE i.status='open' AND i.code='missing_album_artwork' GROUP BY i.album_key LIMIT ?`).all(albumLimit);
  let written = 0;
  for (const row of rows) {
    const destination = join(albumFolder(row.path), "cover.jpg");
    if (await exists(destination)) {
      db.prepare("UPDATE issues SET status='resolved',updated_at=CURRENT_TIMESTAMP WHERE album_key=? AND code='missing_album_artwork'").run(row.album_key);
      continue;
    }
    try {
      const candidate = await albumCandidate(row);
      if (candidate?.score >= 0.72 && await persist(candidate.url, destination, row.album_key, "cover", candidate.provider, candidate.score) === "written") written++;
    } catch (error) { console.error(`album ${row.artist_name} / ${row.album_name}: ${error}`); }
    await pause(150);
  }
  return { considered: rows.length, written };
}

function creditNames() {
  const names = new Set();
  for (const row of db.prepare("SELECT artist_name,tags_json FROM files").iterate()) {
    names.add(row.artist_name);
    try { const tags = JSON.parse(row.tags_json); for (const key of ["artist", "albumArtist", "composer"]) for (const name of values(tags[key])) names.add(name); } catch {}
  }
  return [...names].map(x => x.trim()).filter(x => x && !/#{2,}/.test(x));
}

async function backfillArtist(name) {
  const destination = artistPath(name);
  if (await exists(destination)) return "existing";
  if (!skipMusicBrainz) try {
    const search = await musicBrainzJson("artist/", { query: `artist:\"${name}\"`, limit: "6" });
    const match = (search.artists || []).map(item => ({ ...item, score: similarity(name, item.name) }))
      .filter(item => item.score >= 0.82).sort((a, b) => b.score - a.score)[0];
    if (match) {
      const detail = await musicBrainzJson(`artist/${match.id}`, { inc: "url-rels" });
      const relation = (detail.relations || []).find(item => item.type === "wikidata" || item.url?.resource?.includes("wikidata.org/wiki/Q"));
      const qid = relation?.url?.resource?.match(/(Q\d+)$/)?.[1];
      if (qid) {
        const entity = await fetchJson(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
        const filename = entity.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
        if (filename) {
          const image = `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(filename)}?width=1200`;
          const result = await persist(image, destination, `credit:${norm(name)}`, "artist", "wikimedia", match.score);
          if (result === "written" || result === "existing") return result;
        }
      }
    }
  } catch (error) { console.error(`wikimedia ${name}: ${error}`); }
  const result = await fetchJson(`https://api.deezer.com/search/artist?limit=8&q=${encodeURIComponent(name)}`);
  const candidate = (result.data || []).map(item => ({ ...item, score: similarity(name, item.name) }))
    .filter(item => item.picture_xl && item.score >= 0.82).sort((a, b) => b.score - a.score)[0];
  if (!candidate) {
    db.prepare(`INSERT INTO artwork_attempts(entity_key,kind,provider,status,message,policy_version)
      VALUES(?,'artist','deezer-search','rejected','No sufficiently similar artist result',?)`).run(`credit:${norm(name)}`,artworkPolicyVersion);
    return "missing";
  }
  return persist(candidate.picture_xl, destination, `credit:${norm(name)}`, "artist", "deezer-search", candidate.score);
}

async function backfillArtists() {
  const rejected = retryMissing ? new Set() : new Set(db.prepare("SELECT entity_key FROM artwork_attempts WHERE kind='artist' AND provider='deezer-search' AND status='rejected' AND policy_version=?").all(artworkPolicyVersion).map(x => x.entity_key));
  const pending = [];
  for (const name of creditNames()) if (!rejected.has(`credit:${norm(name)}`) && !await exists(artistPath(name))) pending.push(name);
  let cursor = 0, written = 0;
  async function worker() { while (cursor < Math.min(pending.length, artistLimit)) { const name = pending[cursor++]; try { if (await backfillArtist(name) === "written") written++; } catch (error) { console.error(`artist ${name}: ${error}`); } await pause(120); } }
  await Promise.all(Array.from({ length: artworkWorkers }, worker));
  return { missingBefore: pending.length, considered: Math.min(pending.length, artistLimit), written };
}

const result = { albums: await backfillAlbums(), artists: await backfillArtists() };
console.log(JSON.stringify(result, null, 2));
db.close();
import "./alias-composite-artwork.mjs";
