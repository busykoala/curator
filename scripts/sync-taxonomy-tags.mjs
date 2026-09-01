import Database from "better-sqlite3";
import { execFile as execFileCallback } from "node:child_process";
import { copyFile, open, rename, stat, unlink, utimes } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const db = new Database(process.env.CURATOR_DB_PATH || "/app/data/curator.sqlite");
const concurrency = Math.max(1, Math.min(8, Number(process.env.TAXONOMY_WRITE_CONCURRENCY || 6)));
const pathFilter = process.argv.find((argument) => argument.startsWith("--contains="))?.slice(11).toLowerCase() || "";
const dryRun = process.argv.includes("--dry-run");
const aliasesOnly = process.argv.includes("--aliases-only");
const semantic = process.argv.includes("--semantic");

function values(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
}

function sameValues(left = [], right = []) {
  return [...left].sort().join("\0") === [...right].sort().join("\0");
}

function taxonomyKey(value) {
  return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function canonicalPhysical(current) {
  const genres = [];
  const styles = [...current.style];
  for (const value of current.genre) {
    const key = taxonomyKey(value);
    if (key.includes("musiques du monde") && key.includes("amerique latine")) genres.push("World", "Latin");
    else if (/^(alternatif et inde|alternativa e indie|alternative and indie|alternative indie|indie)$/.test(key)) genres.push("Alternative");
    else if (/^(musiques du monde|world)$/.test(key)) genres.push("World");
    else if (/^(amerique latine)$/.test(key)) genres.push("Latin");
    else if (/^(latin pop|pop latino)$/.test(key)) { genres.push("Latin", "Pop"); styles.push("Latin Pop"); }
    else if (key === "new jack swing") { genres.push("R&B"); styles.push("New Jack Swing"); }
    else genres.push(value);
  }
  const cleanStyles = styles.flatMap((value) => {
    const key = taxonomyKey(value);
    if (/^(alternatif et inde|alternativa e indie|alternative and indie|alternative indie)$/.test(key)) return ["Indie"];
    if (["alternative", "world", "musiques du monde", "amerique latine", "latin"].includes(key)) return [];
    if (/^(pop rock|poprock)$/.test(key)) return ["Pop Rock"];
    if (/^(folk rock|folkrock)$/.test(key)) return ["Folk Rock"];
    if (/^(country rock|countryrock)$/.test(key)) return ["Country Rock"];
    return [value];
  });
  return { genre: values(genres), style: values(cleanStyles) };
}

async function currentTags(filePath) {
  const { stdout } = await execFile("metaflac", ["--show-tag=GENRE", "--show-tag=STYLE", "--show-tag=MOOD", "--show-tag=SCENE", filePath]);
  const result = { genre: [], style: [], mood: [], scene: [] };
  for (const line of stdout.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    if (key in result) result[key].push(line.slice(separator + 1).trim());
  }
  return { genre: values(result.genre), style: values(result.style) };
}

async function applyTags(filePath, desired, links) {
  const target = links > 1 ? `${filePath}.curator-taxonomy-${process.pid}` : filePath;
  if (links > 1) await copyFile(filePath, target);
  try {
    const args = ["--remove-tag=GENRE", "--remove-tag=STYLE"];
    if (semantic) args.push("--remove-tag=MOOD", "--remove-tag=SCENE");
    for (const genre of desired.genre) args.push(`--set-tag=GENRE=${genre}`);
    for (const style of desired.style) args.push(`--set-tag=STYLE=${style}`);
    if (semantic) for (const mood of desired.mood) args.push(`--set-tag=MOOD=${mood}`);
    if (semantic) for (const scene of desired.scene) args.push(`--set-tag=SCENE=${scene}`);
    args.push(target);
    const before = (await execFile("metaflac", ["--show-md5sum", target])).stdout.trim();
    await execFile("metaflac", args);
    const after = (await execFile("metaflac", ["--show-md5sum", target])).stdout.trim();
    if (!before || before !== after) throw new Error("FLAC audio checksum changed");
    const now = new Date();
    await utimes(target, now, now);
    if (links > 1) {
      const handle = await open(target, "r");
      await handle.sync();
      await handle.close();
      await rename(target, filePath);
    }
  } catch (error) {
    if (links > 1) await unlink(target).catch(() => undefined);
    throw error;
  }
}

const rows = db.prepare("SELECT path, tags_json FROM files ORDER BY path").all()
  .filter((row) => !pathFilter || row.path.toLowerCase().includes(pathFilter));
const counters = { examined: 0, wouldChange: 0, changed: 0, unchanged: 0, missing: 0, mp3Deferred: 0, failed: 0 };
let cursor = 0;

async function worker() {
  while (cursor < rows.length) {
    const row = rows[cursor++];
    const filePath = row.path.startsWith("/music/") ? row.path : path.join("/music", row.path);
    if (path.extname(filePath).toLowerCase() !== ".flac") {
      counters.mp3Deferred++;
      continue;
    }
    counters.examined++;
    try {
      const fileStat = await stat(filePath);
      const tags = JSON.parse(row.tags_json || "{}");
      const current = await currentTags(filePath);
      const desired = aliasesOnly
        ? canonicalPhysical(current)
        : { genre: values(tags.genre), style: values(tags.style || tags.STYLE), mood: values(tags.mood || tags.MOOD), scene: values(tags.scene || tags.SCENE) };
      const same= sameValues(current.genre, desired.genre)&&sameValues(current.style, desired.style)&&(!semantic||(sameValues(current.mood,desired.mood)&&sameValues(current.scene,desired.scene)));
      if (same) {
        counters.unchanged++;
        continue;
      }
      counters.wouldChange++;
      if (dryRun) continue;
      await applyTags(filePath, desired, fileStat.nlink);
      counters.changed++;
    } catch (error) {
      if (error?.code === "ENOENT") counters.missing++;
      else {
        counters.failed++;
        console.error(`${filePath}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
console.log(JSON.stringify(counters));
db.close();
