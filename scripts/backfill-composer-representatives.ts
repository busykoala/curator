import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { splitArtistCredits, splitComposerCredits } from "../src/features/scanner/credits";
import { centralArtistPath } from "../src/features/artwork/manager";
import { clean } from "../src/features/scanner/normalize";

type Tags = Record<string, unknown>;
type Context = { albumArtist: string; artist: string; path: string };

function firstJson(text: string): { report: { composer: { missing: string[] } } } {
  const marker = text.indexOf("\nnpm notice");
  return JSON.parse(marker > 0 ? text.slice(0, marker) : text);
}

function values(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(values);
  const result = clean(value);
  return result ? [result] : [];
}

function hash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const placeholderNames = [
  "Asheru of The Unspoken Heard", "Betty Steeles", "Busy Signal, The Flexican & FS Green",
  "Harald Baumgartner", "Ken Boogaloo", "Billy Duffy", "Brian Loving", "Cameron Gipp", "Gene Byrd",
];

const audit = firstJson(readFileSync(process.argv[2] ?? "/app/data/credit-latest-audit.json", "utf8"));
const missing = new Set(audit.report.composer.missing);
const badHashes = new Set(placeholderNames.flatMap((name) => {
  const path = centralArtistPath(name);
  return path && existsSync(path) ? [hash(path)] : [];
}));
const db = new Database(process.env.CURATOR_DB_PATH ?? "/app/data/curator.sqlite", { readonly: true });
const contexts = new Map<string, Context>();

for (const row of db.prepare("SELECT path,tags_json FROM files").all() as Array<{ path: string; tags_json: string }>) {
  const tags = JSON.parse(row.tags_json) as Tags;
  const composers = splitComposerCredits(values(tags.composer));
  const albumArtist = splitArtistCredits(values(tags.albumArtist))[0] ?? "";
  const artist = splitArtistCredits(values(tags.artist))[0] ?? "";
  for (const composer of composers) {
    if (missing.has(composer) && !contexts.has(composer)) contexts.set(composer, { albumArtist, artist, path: row.path });
  }
}

const apply = process.argv.includes("--apply");
const results: Array<Record<string, unknown>> = [];
for (const name of missing) {
  const context = contexts.get(name);
  const destination = centralArtistPath(name);
  if (!context || !destination || existsSync(destination)) continue;
  const sources = [centralArtistPath(context.albumArtist), centralArtistPath(context.artist), join(dirname(context.path), "cover.jpg")]
    .filter((path): path is string => Boolean(path && existsSync(path)));
  const source = sources.find((path) => !badHashes.has(hash(path)));
  if (!source) {
    results.push({ name, status: "no-safe-context-image", context });
    continue;
  }
  if (apply) copyFileSync(source, destination);
  results.push({ name, status: apply ? "written" : "candidate", source, context });
}

console.log(JSON.stringify({ apply, results }, null, 2));
