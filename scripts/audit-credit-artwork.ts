import Database from "better-sqlite3";
import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { splitArtistCredits, splitComposerCredits } from "../src/features/scanner/credits";
import { centralArtistPath } from "../src/features/artwork/manager";

type Kind = "artist" | "albumArtist" | "composer";
type Tags = Record<string, unknown> & { extraProperties?: Record<string, unknown> };

const db = new Database(process.env.CURATOR_DB_PATH ?? "/app/data/curator.sqlite", { readonly: true });
const roots = new Map<Kind, Set<string>>([
  ["artist", new Set()],
  ["albumArtist", new Set()],
  ["composer", new Set()],
]);
const contexts = new Map<Kind, Map<string, Set<string>>>([
  ["artist", new Map()],
  ["albumArtist", new Map()],
  ["composer", new Map()],
]);

function values(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(values);
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function add(kind: Kind, names: string[], context: string): void {
  const target = roots.get(kind)!;
  for (const name of names) {
    if (!name.trim()) continue;
    target.add(name.trim());
    const byName = contexts.get(kind)!;
    const values = byName.get(name.trim()) ?? new Set<string>();
    values.add(context);
    byName.set(name.trim(), values);
  }
}

function valid(path: string): boolean {
  return existsSync(path) && statSync(path).isFile() && statSync(path).size > 0;
}

function words(value: string): string[] {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function compatible(short: string[], long: string[]): boolean {
  return short.length === long.length && short.every((part, index) =>
    part.length === 1 ? long[index]?.startsWith(part) : part === long[index]);
}

const imageDir = "/music/.artist-images";
const candidates = readdirSync(imageDir)
  .filter((name) => !name.startsWith("._"))
  .filter((name) => /\.(jpe?g|png|webp)$/i.test(name));

function uniqueAlias(name: string): string | undefined {
  const expected = words(name);
  const matches = candidates.filter((file) => {
    const candidate = words(basename(file, extname(file)));
    return compatible(expected, candidate) || compatible(candidate, expected);
  });
  return matches.length === 1 ? join(imageDir, matches[0]) : undefined;
}

function collaborationRepresentative(name: string): string | undefined {
  const parsed = splitComposerCredits(name);
  const participants = parsed.length > 1
    ? parsed
    : name.split(/\s+(?:featuring|feat\.?|with|of)\s+/i).map((part) => part.trim());
  if (participants.length < 2) return undefined;
  for (const participant of participants) {
    const path = centralArtistPath(participant);
    if (path && valid(path)) return path;
  }
  return undefined;
}

for (const row of db.prepare("SELECT artist_name,album_name,tags_json FROM files").all() as Array<{
  artist_name: string; album_name: string; tags_json: string;
}>) {
  const tags = JSON.parse(row.tags_json) as Tags;
  const extra = tags.extraProperties ?? {};
  const context = `${row.artist_name} / ${row.album_name}`;
  add("artist", splitArtistCredits([...values(tags.artist), ...values(tags.ARTIST)]), context);
  add("albumArtist", splitArtistCredits([
    ...values(tags.albumArtist), ...values(tags.ALBUMARTIST), ...values(extra.ALBUMARTIST),
  ]), context);
  add("composer", splitComposerCredits([
    ...values(tags.composer), ...values(tags.COMPOSER), ...values(extra.COMPOSER),
  ]), context);
}

const apply = process.argv.includes("--apply-local-aliases");
let aliasesWritten = 0;
const report: Record<Kind, {
  total: number; present: number; missing: string[]; contexts: Record<string, string[]>;
}> = {} as never;

for (const [kind, names] of roots) {
  for (const name of names) {
    const destination = centralArtistPath(name);
    if (!destination) continue;
    if (valid(destination)) continue;
    const source = uniqueAlias(name) ?? collaborationRepresentative(name);
    if (apply && source && source !== destination) {
      copyFileSync(source, destination);
      aliasesWritten += 1;
    }
  }
  const missing = [...names].filter((name) => {
    const path = centralArtistPath(name);
    return !path || !valid(path);
  }).sort();
  report[kind] = {
    total: names.size,
    present: names.size - missing.length,
    missing,
    contexts: Object.fromEntries(missing.map((name) => [name, [...(contexts.get(kind)!.get(name) ?? [])].slice(0, 5)])),
  };
}

console.log(JSON.stringify({ apply, aliasesWritten, report }, null, 2));
