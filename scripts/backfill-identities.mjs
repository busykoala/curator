import Database from "better-sqlite3";

const db = new Database(process.env.CURATOR_DB_PATH || "/app/data/curator.sqlite");
db.pragma("busy_timeout=10000");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const asList = value => Array.isArray(value) ? value : typeof value === "string" && value.trim() ? [value] : [];
const parse = value => { try { return JSON.parse(value || "{}"); } catch { return {}; } };
const fold = value => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const editionNoise = /\b(deluxe|expanded|remaster(?:ed)?|anniversary|edition|version|mix|mono|stereo|bonus|japan(?:ese)?|sacd|vinyl|disc|cd)\b/i;
const cleanTitle = value => fold(String(value || "").replace(/[[(]([^\])]+)[\])]/g, (all, inner) => editionNoise.test(inner) ? " " : all).replace(/\b(?:disc|cd)\s*\d+\b/gi, " "));
const tokens = value => new Set(fold(value).split(" ").filter(Boolean));
function similarity(left, right) {
  const a = tokens(left), b = tokens(right);
  if (!a.size || !b.size) return 0;
  let common = 0; for (const token of a) if (b.has(token)) common++;
  return (2 * common) / (a.size + b.size);
}
function releaseGroupId(tags) {
  for (const source of [tags, tags.extraProperties || {}]) for (const [key, value] of Object.entries(source)) {
    if (key.replace(/[^a-z0-9]/gi, "").toLowerCase() === "musicbrainzreleasegroupid" && asList(value).length) return asList(value)[0];
  }
  return "";
}
async function search(artist, album) {
  const query = `artist:${JSON.stringify(artist)} AND releasegroup:${JSON.stringify(album)}`;
  const url = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&limit=10&fmt=json`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = await fetch(url, { headers: { "User-Agent": "MusicCurator/1.0 (personal-library; https://localhost)" } });
    if (response.ok) return (await response.json())["release-groups"] || [];
    if (![429, 502, 503, 504].includes(response.status) || attempt === 4) throw new Error(`MusicBrainz ${response.status}`);
    await sleep(attempt * 2000);
  }
  return [];
}
function rank(row, candidate) {
  const credit = (candidate["artist-credit"] || []).map(item => item.name || item.artist?.name || "").join(" ");
  const title = similarity(cleanTitle(row.album), cleanTitle(candidate.title));
  const artist = similarity(row.artist, credit);
  const source = Math.max(0, Math.min(1, Number(candidate.score || 0) / 100));
  const candidateYear = Number(String(candidate["first-release-date"] || "").slice(0, 4));
  const year = row.year && candidateYear ? (Math.abs(row.year - candidateYear) <= 1 ? 1 : Math.abs(row.year - candidateYear) <= 5 ? 0.4 : 0) : 0.5;
  const primary = candidate["primary-type"] === "Album" ? 1 : 0.5;
  return { candidate, credit, title, artist, confidence: 0.46 * title + 0.34 * artist + 0.1 * source + 0.06 * year + 0.04 * primary };
}

const rows = db.prepare("SELECT album_key,min(artist_name) artist,min(album_name) album,min(tags_json) tags_json FROM files GROUP BY album_key ORDER BY artist,album").all().map(row => {
  const tags = parse(row.tags_json), year = Number(tags.year || String(tags.date || "").slice(0, 4)) || 0;
  return { ...row, artist: asList(tags.albumArtist)[0] || row.artist, album: asList(tags.album)[0] || row.album, year, existing: releaseGroupId(tags) };
});
const existingOverrides = new Set(db.prepare("SELECT album_key FROM manual_overrides WHERE confirmed=1 AND release_group_mbid IS NOT NULL AND trim(release_group_mbid)<>''").all().map(row => row.album_key));
const targets = rows.filter(row => !row.existing && !existingOverrides.has(row.album_key) && fold(row.artist) !== "unknown artist");
const save = db.prepare(`INSERT INTO manual_overrides(album_key,artist_name,album_name,release_date,artist_mbid,release_group_mbid,confirmed,updated_at)
  VALUES (?,?,?,?,?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(album_key) DO UPDATE SET artist_name=excluded.artist_name,album_name=excluded.album_name,release_date=excluded.release_date,artist_mbid=excluded.artist_mbid,release_group_mbid=excluded.release_group_mbid,confirmed=1,updated_at=CURRENT_TIMESTAMP`);
const state = db.prepare("INSERT INTO state(key,value,updated_at) VALUES ('identity_backfill',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP");
let matched = 0, rejected = 0, failed = 0;
for (let index = 0; index < targets.length; index++) {
  const row = targets[index];
  try {
    const candidates = (await search(row.artist, cleanTitle(row.album) || row.album)).map(candidate => rank(row, candidate)).sort((a, b) => b.confidence - a.confidence);
    const best = candidates[0], next = candidates[1];
    const exact = best && cleanTitle(row.album) === cleanTitle(best.candidate.title) && fold(row.artist) === fold(best.credit);
    const plausible = best && best.title >= 0.68 && best.artist >= 0.72 && (best.confidence >= 0.78 || exact);
    if (plausible) {
      const artistMbid = best.candidate["artist-credit"]?.[0]?.artist?.id || null;
      save.run(row.album_key, row.artist, row.album, best.candidate["first-release-date"] || null, artistMbid, best.candidate.id, 1);
      matched++;
    } else rejected++;
    state.run(JSON.stringify({ total: targets.length, processed: index + 1, matched, rejected, failed, current: `${row.artist} / ${row.album}`, best: best ? { title: best.candidate.title, artist: best.credit, confidence: best.confidence, margin: best.confidence - (next?.confidence || 0) } : null }));
  } catch (error) {
    failed++;
    state.run(JSON.stringify({ total: targets.length, processed: index + 1, matched, rejected, failed, current: `${row.artist} / ${row.album}`, error: String(error) }));
  }
  await sleep(1100);
}
console.log(JSON.stringify({ total: targets.length, matched, rejected, failed }));
