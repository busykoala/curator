import Database from "better-sqlite3";
import { existsSync, readFileSync, renameSync } from "node:fs";
import sharp from "sharp";
import { splitArtistCredits, splitComposerCredits } from "../src/features/scanner/credits";
import { centralArtistPath } from "../src/features/artwork/manager";
import { clean, normalized } from "../src/features/scanner/normalize";

type Tags = Record<string, unknown>;
type SearchTrack = { id: number; title: string; artist: { name: string }; album: { title: string } };
type Contributor = { id: number; name: string; picture_xl?: string };

function firstJson(text: string): { report: { artist: { missing: string[] } } } {
  const marker = text.indexOf("\nnpm notice");
  return JSON.parse(marker > 0 ? text.slice(0, marker) : text);
}

function values(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(values);
  const result = clean(value);
  return result ? [result] : [];
}

function safePicture(url?: string): boolean {
  return Boolean(url && /^https:\/\/[^/]*dzcdn\.net\//i.test(url)
    && !url.includes("/artist//") && !url.includes("d41d8cd98f00b204e9800998ecf8427e"));
}

async function json(url: URL | string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function collage(images: Buffer[]): Promise<Buffer> {
  if (images.length === 1) return sharp(images[0]).rotate().resize(1000, 1000, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer();
  const cells = images.slice(0, 4);
  const width = cells.length === 2 ? 500 : 500;
  const height = cells.length === 2 ? 1000 : 500;
  const prepared = await Promise.all(cells.map((image) => sharp(image).rotate().resize(width, height, { fit: "cover" }).jpeg().toBuffer()));
  const positions = cells.length === 2
    ? [{ left: 0, top: 0 }, { left: 500, top: 0 }]
    : [{ left: 0, top: 0 }, { left: 500, top: 0 }, { left: 0, top: 500 }, { left: 500, top: 500 }];
  return sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ddd7ca" } })
    .composite(prepared.map((input, index) => ({ input, ...positions[index] }))).jpeg({ quality: 90 }).toBuffer();
}

async function exactArtist(name: string): Promise<Contributor | undefined> {
  const query = new URL("https://api.deezer.com/search/artist");
  query.searchParams.set("q", name);
  query.searchParams.set("limit", "10");
  const result = await json(query) as { data?: Array<Contributor & { nb_fan?: number }> };
  const matches = (result.data ?? []).filter((artist) => normalized(artist.name) === normalized(name)
    && safePicture(artist.picture_xl)).sort((a, b) => (b.nb_fan ?? 0) - (a.nb_fan ?? 0));
  const lead = matches[0];
  const decisive = matches.length === 1 || (lead && (lead.nb_fan ?? 0) >= 50
    && (lead.nb_fan ?? 0) >= Math.max(1, (matches[1]?.nb_fan ?? 0) * 5));
  return decisive ? lead : undefined;
}

async function writeContributors(destination: string, contributors: Contributor[]): Promise<void> {
  const images = await Promise.all(contributors.slice(0, 4).map(async (person) => {
    const response = await fetch(person.picture_xl!, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`image HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }));
  const output = await collage(images);
  const temporary = `${destination}.curator-composite-${process.pid}`;
  await sharp(output).jpeg({ quality: 90, mozjpeg: true }).toFile(temporary);
  renameSync(temporary, destination);
}

async function main(): Promise<void> {
  const audit = firstJson(readFileSync(process.argv[2] ?? "/app/data/credit-progress-audit.json", "utf8"));
  const missing = new Set(audit.report.artist.missing);
  const db = new Database(process.env.CURATOR_DB_PATH ?? "/app/data/curator.sqlite", { readonly: true });
  const evidence = new Map<string, { title: string; album: string; albumArtist: string }>();
  for (const row of db.prepare("SELECT tags_json FROM files").all() as Array<{ tags_json: string }>) {
    const tags = JSON.parse(row.tags_json) as Tags;
    const artist = splitArtistCredits(values(tags.artist));
    const target = artist.find((name) => missing.has(name));
    if (!target || evidence.has(target)) continue;
    evidence.set(target, {
      title: values(tags.title)[0] ?? "",
      album: values(tags.album)[0] ?? "",
      albumArtist: values(tags.albumArtist)[0] ?? "",
    });
  }

  const apply = process.argv.includes("--apply");
  const results: Array<Record<string, unknown>> = [];
  for (const name of missing) {
    const context = evidence.get(name);
    const destination = centralArtistPath(name);
    if (!context || !destination || existsSync(destination)) continue;
    try {
      const query = new URL("https://api.deezer.com/search/track");
      query.searchParams.set("q", `${context.title} ${context.albumArtist}`);
      query.searchParams.set("limit", "15");
      const search = await json(query) as { data?: SearchTrack[] };
      const ranked = (search.data ?? []).map((track) => ({ track, score:
        (normalized(track.title) === normalized(context.title) ? 4 : 0)
        + (normalized(track.album.title) === normalized(context.album) ? 2 : 0)
        + (normalized(track.artist.name) === normalized(context.albumArtist) ? 2 : 0),
      })).sort((a, b) => b.score - a.score);
      const ties = ranked.filter((entry) => entry.score === ranked[0]?.score);
      const equivalentTies = ties.every((entry) => normalized(entry.track.title) === normalized(ranked[0]?.track.title ?? "")
        && normalized(entry.track.artist.name) === normalized(ranked[0]?.track.artist.name ?? ""));
      if (!ranked[0] || ranked[0].score < 6 || (ties.length > 1 && !equivalentTies)) {
        const parts = splitComposerCredits(name).flatMap((part) => part.split(/\s+of\s+/i));
        const contributors = (await Promise.all(parts.map(exactArtist))).filter(Boolean) as Contributor[];
        if (!contributors.length) {
          results.push({ name, status: "no-decisive-track", context });
          continue;
        }
        if (apply) await writeContributors(destination, contributors);
        results.push({ name, status: apply ? "written" : "candidate-components",
          contributors: contributors.map((person) => ({ id: person.id, name: person.name })) });
        continue;
      }
      const track = await json(`https://api.deezer.com/track/${ranked[0].track.id}`) as { contributors?: Contributor[] };
      const expanded = splitComposerCredits(name).flatMap((part) => part.split(/\s+of\s+/i));
      const components = expanded.map((part) => normalized(part).replace(/\s+/g, ""));
      const contributors = (track.contributors ?? []).filter((person) => safePicture(person.picture_xl)
        && (components.includes(normalized(person.name).replace(/\s+/g, "")) || normalized(person.name) === normalized(name)));
      if (!contributors.length) {
        const fallback = (await Promise.all(expanded.map(exactArtist))).filter(Boolean) as Contributor[];
        if (!fallback.length) {
          results.push({ name, status: "no-matching-contributor", trackId: ranked[0].track.id });
          continue;
        }
        if (apply) await writeContributors(destination, fallback);
        results.push({ name, status: apply ? "written" : "candidate-components", trackId: ranked[0].track.id,
          contributors: fallback.map((person) => ({ id: person.id, name: person.name })) });
        continue;
      }
      if (apply) {
        await writeContributors(destination, contributors);
      }
      results.push({ name, status: apply ? "written" : "candidate", trackId: ranked[0].track.id,
        contributors: contributors.map((person) => ({ id: person.id, name: person.name })) });
    } catch (error) {
      results.push({ name, status: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }
  console.log(JSON.stringify({ apply, results }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
