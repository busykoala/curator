import Database from "better-sqlite3";

const db = new Database(process.env.CURATOR_DB_PATH || "/app/data/curator.sqlite");

function text(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function values(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
}

function canonicalStyle(value) {
  const normalized = text(value);
  if (!normalized || ["alternative", "world", "musiques du monde", "amerique latine", "latin"].includes(normalized)) return [];
  if (/^(alternatif et inde|alternativa e indie|alternative (and|et) indie|alternative indie)$/.test(normalized)) return ["Indie"];
  if (/^indie$/.test(normalized)) return ["Indie"];
  if (/^(pop rock|poprock)$/.test(normalized)) return ["Pop Rock"];
  if (/^(folk rock|folkrock)$/.test(normalized)) return ["Folk Rock"];
  if (/^(country rock|countryrock)$/.test(normalized)) return ["Country Rock"];
  if (/^(latin pop|pop latino)$/.test(normalized)) return ["Latin Pop"];
  if (/^new jack swing$/.test(normalized)) return ["New Jack Swing"];
  if (/^(wave|new wave)$/.test(normalized)) return ["New Wave"];
  if (/^elektro$/.test(normalized)) return ["Electronica"];
  return [String(value).trim()];
}

const rows = db.prepare("SELECT id, tags_json FROM files").all();
const update = db.prepare("UPDATE files SET tags_json = ?, status = 'analyzed', desired_hash = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
let changed = 0;

db.transaction(() => {
  for (const row of rows) {
    let tags;
    try { tags = JSON.parse(row.tags_json || "{}"); } catch { continue; }
    const before = values(tags.style || tags.STYLE || tags.extraProperties?.STYLE);
    const after = [...new Set(before.flatMap(canonicalStyle))].slice(0, 3);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    tags.style = after;
    tags.STYLE = after;
    tags.extraProperties = { ...(tags.extraProperties || {}), STYLE: after };
    update.run(JSON.stringify(tags), row.id);
    changed++;
  }
})();

db.prepare("UPDATE taxonomy_terms SET active = 0 WHERE kind = 'style' AND lower(name) IN ('alternatif et indé','alternativa e indie','alternative & indie','pop/rock','folk/rock','folk-rock','country-rock')").run();
console.log(JSON.stringify({ examined: rows.length, changed }));
db.close();
