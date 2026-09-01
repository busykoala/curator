import { existsSync, readFileSync } from "node:fs";
import { centralArtistPath } from "../src/features/artwork/manager";

type Resolution = { inputName: string; canonicalName: string | null; confidence: number };
type Artist = { id: number; name: string; nb_fan?: number; picture_xl?: string };

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function usablePicture(url?: string): boolean {
  return Boolean(url && !url.includes("/artist//") && !url.includes("d41d8cd98f00b204e9800998ecf8427e"));
}

async function main(): Promise<void> {
  const payload = JSON.parse(readFileSync(process.argv[2] ?? "/app/data/credit-alias-resolutions.json", "utf8")) as {
    resolved: Resolution[];
  };
  const pending = payload.resolved.filter((item) => {
    const destination = centralArtistPath(item.inputName);
    return item.canonicalName && item.confidence >= 0.85 && destination && !existsSync(destination);
  });
  const results: Array<Record<string, unknown>> = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < pending.length) {
      const item = pending[cursor++];
      const query = new URL("https://api.deezer.com/search/artist");
      query.searchParams.set("q", item.canonicalName!);
      query.searchParams.set("limit", "10");
      try {
        const response = await fetch(query, { signal: AbortSignal.timeout(12_000) });
        const payload = await response.json() as { data?: Artist[] };
        const matches = (payload.data ?? [])
          .filter((artist) => normalized(artist.name) === normalized(item.canonicalName!))
          .filter((artist) => usablePicture(artist.picture_xl))
          .sort((a, b) => (b.nb_fan ?? 0) - (a.nb_fan ?? 0));
        const lead = matches[0];
        const decisive = matches.length === 1 || (lead && (lead.nb_fan ?? 0) >= 50
          && (lead.nb_fan ?? 0) >= Math.max(1, (matches[1]?.nb_fan ?? 0) * 5));
        results.push({ ...item, status: decisive ? "candidate" : "ambiguous", candidate: decisive ? lead : null, matches });
      } catch (error) {
        results.push({ ...item, status: "failed", message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  await Promise.all(Array.from({ length: 4 }, () => worker()));
  console.log(JSON.stringify({ total: pending.length, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
