import Database from "better-sqlite3";

const normalLog = console.log;
console.log = () => undefined;
await import("./normalize-taxonomy.mjs");
await import("./normalize-style-aliases.mjs");
console.log = normalLog;

const db = new Database(process.env.CURATOR_DB ?? "/app/data/curator.sqlite");
db.pragma("busy_timeout = 5000");

const damaged = (value) =>
  typeof value === "string" && (value.includes("##") || value.includes("\uFFFD"));
const invalidComposer = (value) => /^(?:see subsong|traditional)$/i.test(value.trim()) || /(?:bluebird \(3\)|bertelsmann music group|<<+|>>+|¤{2}|\bvari+ous\b)/i.test(value);
const values = (value) => (Array.isArray(value) ? value : value ? [value] : []).map(String).map((item) => item.trim()).filter(Boolean);
const comparable = (value) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, "");
const fileTitle = (filePath) => filePath.split("/").pop().replace(/\.[^.]+$/, "").split(" - ").slice(3).join(" - ").trim();

const artistGenres = new Map();
for (const row of db.prepare("SELECT artist_name, tags_json FROM files").iterate()) {
  const genres = values(JSON.parse(row.tags_json).genre);
  if (!genres.length) continue;
  const counts = artistGenres.get(row.artist_name) ?? new Map();
  for (const genre of genres) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  artistGenres.set(row.artist_name, counts);
}
const inferredGenres = (artist) => [...(artistGenres.get(artist) ?? new Map())]
  .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([genre]) => genre);

const artistDescription = (artist) => `${artist} is the credited artist for this music.`;
const albumDescription = (artist, album) => `${album} is an album by ${artist}.`;

let rows = db.prepare(`
  SELECT id, path, artist_name, album_name, tags_json
  FROM files
  WHERE tags_json LIKE '%##%' OR tags_json LIKE '%�%'
     OR lower(tags_json) LIKE '%see subsong%'
     OR lower(tags_json) LIKE '%traditional%'
     OR lower(tags_json) LIKE '%variious%'
     OR lower(tags_json) LIKE '%bertelsmann music group%'
     OR coalesce(json_extract(tags_json, '$.albumArtist'), '') = ''
     OR trim(coalesce(json_extract(tags_json, '$.genre[0]'), json_extract(tags_json, '$.genre'), '')) = ''
`).all();

rows = db.prepare("SELECT id, path, artist_name, album_name, tags_json FROM files").all();

const update = db.prepare(`
  UPDATE files
  SET tags_json = ?, status = 'analyzed', desired_hash = NULL,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

let repaired = 0;
let skipped = 0;
const repair = db.transaction(() => {
  for (const row of rows) {
    const tags = JSON.parse(row.tags_json);
    let changed = false;
    if (!(Array.isArray(tags.albumArtist) ? tags.albumArtist[0] : tags.albumArtist)) {
      tags.albumArtist = row.artist_name;
      tags.extraProperties ??= {};
      tags.extraProperties.ALBUMARTIST = [row.artist_name];
      changed = true;
    }
    if (!values(tags.genre).length) {
      const genres = inferredGenres(row.artist_name);
      if (genres.length) {
        tags.genre = genres;
        tags.extraProperties ??= {};
        tags.extraProperties.GENRE = genres;
        changed = true;
      }
    }

    const currentTitle = values(tags.title)[0] ?? "";
    const fromPath = fileTitle(row.path);
    const currentComparable = comparable(currentTitle);
    const pathComparable = comparable(fromPath);
    const half = currentComparable.slice(0, currentComparable.length / 2);
    const repeated = currentComparable.length >= 6 && currentComparable.length % 2 === 0 && half === currentComparable.slice(currentComparable.length / 2);
    const restoresUnicode = pathComparable === currentComparable && /[^\x00-\x7F]/.test(fromPath) && !/[^\x00-\x7F]/.test(currentTitle);
    if (fromPath && (repeated || restoresUnicode)) {
      tags.title = fromPath;
      if (tags.extraProperties?.TITLE) tags.extraProperties.TITLE = [fromPath];
      changed = true;
    }
    const replacements = {
      ARTISTDESCRIPTION: `${row.artist_name} is the credited artist for this music.`,
      ALBUMDESCRIPTION: `${row.album_name} is an album by ${row.artist_name}.`,
    };

    for (const [key, fallback] of Object.entries(replacements)) {
      const current = tags[key];
      if (Array.isArray(current) && current.some(damaged)) {
        tags[key] = [fallback];
        changed = true;
      } else if (damaged(current)) {
        tags[key] = [fallback];
        changed = true;
      }

      const extra = tags.extraProperties?.[key];
      if (Array.isArray(extra) && extra.some(damaged)) {
        tags.extraProperties[key] = [fallback];
        changed = true;
      } else if (damaged(extra)) {
        tags.extraProperties[key] = [fallback];
        changed = true;
      }
    }

    for (const key of ["composer", "COMPOSER"]) {
      const owner = key === "composer" ? tags : tags.extraProperties;
      if (!owner) continue;
      const current = owner[key];
      const values = Array.isArray(current) ? current : current ? [current] : [];
      const clean = values.filter((value) => typeof value === "string" && !invalidComposer(value));
      if (clean.length !== values.length) {
        if (clean.length) owner[key] = clean;
        else delete owner[key];
        changed = true;
      }
    }

    if (changed) {
      update.run(JSON.stringify(tags), row.id);
      repaired += 1;
    } else {
      skipped += 1;
    }
  }
});

repair();
db.close();
console.log(JSON.stringify({ examined: rows.length, repaired, skipped }));
