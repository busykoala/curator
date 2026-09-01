import Database from "better-sqlite3";

const db = new Database(process.env.CURATOR_DB ?? "/app/data/curator.sqlite");
db.pragma("busy_timeout = 5000");
const key = (value) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}&]+/gu, " ").trim();
const list = (value) => (Array.isArray(value) ? value : value ? [value] : []).map(String).map((item) => item.trim()).filter(Boolean);
const add = (target, value) => { if (value && !target.some((item) => key(item) === key(value))) target.push(value); };

function classify(value) {
  const n = key(value), genres = [], styles = [];
  if (!n || n === "0" || n === "unknown" || n === "smiths" || n === "hard") return { genres, styles };
  const genre = (name) => add(genres, name), style = (name) => add(styles, name);
  if (/alternativ|alternatif|indie|et inde/.test(n)) { genre("Alternative"); if (/indie|et inde/.test(n)) style("Indie"); }
  if (/musiques du monde|^world$/.test(n)) genre("World");
  if (/amerique latine/.test(n)) genre("Latin");
  if (/latin pop/.test(n)) { genre("Latin"); genre("Pop"); style("Latin Pop"); }
  else if (/latin/.test(n)) genre("Latin");
  if (/new jack swing/.test(n)) { genre("R&B"); style("New Jack Swing"); }
  if (/singer songwriter|singer songwrit/.test(n)) { genre("Folk"); style("Singer-Songwriter"); }
  if (/dance hall|dancehall/.test(n)) { genre("Reggae"); style("Dancehall"); }
  if (/hip hop|hip-hop|\brap\b|rapcore/.test(n)) genre("Hip-Hop");
  if (/r&b|rhythmic soul/.test(n)) genre("R&B");
  if (/soul/.test(n)) genre("Soul");
  if (/funk/.test(n) && !/funk metal/.test(n)) genre("Funk");
  if (/reggae/.test(n)) genre("Reggae");
  if (/country/.test(n)) genre("Country");
  if (/blues/.test(n)) genre("Blues");
  if (/folk/.test(n)) genre("Folk");
  if (/punk/.test(n)) genre("Punk");
  if (/metal/.test(n)) genre("Metal");
  if (/\brock\b|rock$/.test(n)) genre("Rock");
  if (/\bpop\b|popular|brit pop|dream pop/.test(n) && !/latin pop/.test(n)) genre("Pop");
  if (/jazz/.test(n)) genre("Jazz");
  if (/house/.test(n)) genre("House");
  if (/electro|elektro|electronic|electronique|industrial|downtempo|trip hop|dubstep|garage|psybient|psydub|ambient|techno|lo fi|wave/.test(n)) genre("Electronic");
  if (/wave|techno|lo fi/.test(n)) style(value.replace(/\s+/g, " "));
  if (/ambient/.test(n)) genre("Ambient");
  if (/\bdance\b/.test(n) && !/jazz dance/.test(n)) genre("Dance");
  if (/classical/.test(n)) genre("Classical");
  if (/soundtrack/.test(n)) genre("Soundtrack");
  if (/christmas/.test(n)) genre("Christmas");
  if (/chanson/.test(n)) genre("Chanson");
  const broad = new Set(["rock","pop","alternative","electronic","r&b","soul","folk","reggae","metal","punk","jazz","country","blues","hip hop","hip-hop","house","funk","latin","ambient","dance","classical","world","soundtrack","christmas","chanson"]);
  if (genres.length && !broad.has(n) && !/alternativ|indie|musiques du monde|amerique latine|latin pop|new jack swing|singer|dancehall|hip hop rap|popular/.test(n)) style(value.replace(/\s+/g, " "));
  if (!genres.length && n.length > 2) genre(value.replace(/\s+/g, " "));
  return { genres, styles };
}

function terms(raw) {
  const exact = key(raw);
  if (["alternative & indie", "alternativa e indie", "alternatif et inde"].includes(exact)) return [raw];
  if (["pop rock", "folk rock", "blues rock", "rap hip hop"].includes(exact)) return [raw];
  return raw.split(/\s*[;,|]\s*|\s+\/\s+|\\/).map((item) => item.trim()).filter(Boolean);
}

const rows = db.prepare("SELECT id, artist_name, tags_json FROM files").all();
const curatedArtistDefaults = new Map([
  ["The Byrds", { genres: ["Rock", "Folk"], styles: ["Folk Rock"] }],
]);
const projected = [], artistCounts = new Map();
for (const row of rows) {
  const tags = JSON.parse(row.tags_json), genres = [], styles = [];
  for (const raw of list(tags.genre)) for (const term of terms(raw)) {
    const result = classify(term);
    result.genres.forEach((item) => add(genres, item));
    result.styles.forEach((item) => add(styles, item));
  }
  for (const existing of [...list(tags.style), ...list(tags.STYLE), ...list(tags.extraProperties?.STYLE)]) add(styles, existing);
  const selected = genres.slice(0, 2), counts = artistCounts.get(row.artist_name) ?? new Map();
  for (const genre of selected) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  artistCounts.set(row.artist_name, counts);
  projected.push({ row, tags, genres: selected, styles });
}

const update = db.prepare("UPDATE files SET tags_json=?,status='analyzed',desired_hash=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?");
let changed = 0;
const transaction = db.transaction(() => {
  for (const item of projected) {
    if (!item.genres.length) item.genres = [...(artistCounts.get(item.row.artist_name) ?? new Map())].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name);
    const curated = curatedArtistDefaults.get(item.row.artist_name);
    if (!item.genres.length && curated) {
      item.genres = curated.genres;
      for (const style of curated.styles) add(item.styles, style);
    }
    if (!item.genres.length) item.genres = ["Unknown"];
    const before = JSON.stringify({ genre: item.tags.genre, style: item.tags.style, STYLE: item.tags.STYLE, extra: item.tags.extraProperties?.STYLE });
    item.tags.genre = item.genres;
    item.tags.style = item.styles.slice(0, 3);
    item.tags.STYLE = item.styles.slice(0, 3);
    item.tags.extraProperties ??= {};
    item.tags.extraProperties.GENRE = item.genres;
    item.tags.extraProperties.STYLE = item.styles.slice(0, 3);
    const after = JSON.stringify({ genre: item.tags.genre, style: item.tags.style, STYLE: item.tags.STYLE, extra: item.tags.extraProperties.STYLE });
    if (before !== after) { update.run(JSON.stringify(item.tags), item.row.id); changed += 1; }
  }
  const aliases = {
    Alternative: ["Alternative & Indie", "Alternativa e indie", "Alternatif et Indé", "Indie"],
    World: ["Musiques du monde"], Latin: ["Amérique latine"], Electronic: ["Électronique"]
  };
  for (const [name, names] of Object.entries(aliases)) {
    const normalized = key(name);
    db.prepare("INSERT OR IGNORE INTO taxonomy_terms(kind,name,normalized,aliases_json,active) VALUES ('genre',?,?,?,1)").run(name, normalized, JSON.stringify(names));
    db.prepare("UPDATE taxonomy_terms SET aliases_json=?,active=1 WHERE kind='genre' AND normalized=?").run(JSON.stringify(names), normalized);
    for (const alias of names) db.prepare("UPDATE taxonomy_terms SET active=0 WHERE kind='genre' AND normalized=?").run(key(alias));
  }
});
transaction();
db.close();
console.log(JSON.stringify({ examined: rows.length, changed }));
