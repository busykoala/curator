import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import sharp from "sharp";
import { centralArtistPath } from "../src/features/artwork/manager";

type Report = { report: Record<string, { missing: string[] }> };
type DeezerArtist = { id: number; name: string; picture_xl?: string; picture_big?: string };

function firstJson(text: string): Report {
  const start = text.indexOf("{");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return JSON.parse(text.slice(start, index + 1));
  }
  throw new Error("No complete audit JSON found");
}

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function backfill(name: string): Promise<Record<string, unknown>> {
  const destination = centralArtistPath(name);
  if (!destination) return { name, status: "unsafe-destination" };
  if (existsSync(destination)) return { name, status: "already-present" };
  if (normalized(name).length <= 3) return { name, status: "skipped-short-name" };
  const query = new URL("https://api.deezer.com/search/artist");
  query.searchParams.set("q", name);
  query.searchParams.set("limit", "10");
  const payload = await fetchJson(query.toString()) as { data?: DeezerArtist[] };
  const matches = (payload.data ?? []).filter((artist) => normalized(artist.name) === normalized(name));
  if (matches.length !== 1) return { name, status: "no-unique-exact-match", candidates: matches.length };
  const match = matches[0];
  const imageUrl = match.picture_xl ?? match.picture_big;
  if (!imageUrl || !/^https:\/\/[^/]*dzcdn\.net\//i.test(imageUrl)) {
    return { name, status: "no-safe-image", deezerId: match.id };
  }
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return { name, status: `image-http-${response.status}`, deezerId: match.id };
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > 20_000_000) return { name, status: "image-too-large", deezerId: match.id };
  const metadata = await sharp(data).metadata();
  if ((metadata.width ?? 0) < 500 || (metadata.height ?? 0) < 500) {
    return { name, status: "image-too-small", width: metadata.width, height: metadata.height };
  }
  const temporary = `${destination}.curator-deezer-${process.pid}`;
  try {
    await sharp(data).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90, mozjpeg: true }).toFile(temporary);
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
  return { name, status: "written", deezerId: match.id, imageUrl };
}

async function main(): Promise<void> {
  const input = firstJson(readFileSync(process.argv[2] ?? "/app/data/credit-representatives.json", "utf8"));
  const names = [...new Set(Object.values(input.report).flatMap((entry) => entry.missing))];
  const results: Array<Record<string, unknown>> = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < names.length) {
      const name = names[cursor++];
      try {
        results.push(await backfill(name));
      } catch (error) {
        results.push({ name, status: "failed", message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  await Promise.all(Array.from({ length: 4 }, () => worker()));
  console.log(JSON.stringify({ total: names.length, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
