import { existsSync, readFileSync } from "node:fs";
import { centralArtistPath } from "../src/features/artwork/manager";

type Resolution = { inputName: string; canonicalName: string | null; confidence: number };
type Page = {
  pageid: number;
  title: string;
  fullurl?: string;
  extract?: string;
  original?: { source: string; width: number; height: number };
  thumbnail?: { source: string; width: number; height: number };
};

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\s*\([^)]*\)\s*$/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

async function main(): Promise<void> {
  const payload = JSON.parse(readFileSync(process.argv[2] ?? "/app/data/credit-alias-resolutions.json", "utf8")) as {
    resolved: Resolution[];
  };
  const pending = payload.resolved.filter((item) => {
    const destination = centralArtistPath(item.inputName);
    return item.canonicalName && item.confidence >= 0.85 && destination && !existsSync(destination);
  });
  const batchedResults: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < pending.length; offset += 40) {
    const batch = pending.slice(offset, offset + 40);
    const direct = new URL("https://en.wikipedia.org/w/api.php");
    for (const [key, value] of Object.entries({
      action: "query", titles: batch.map((item) => item.canonicalName).join("|"), redirects: "1",
      prop: "pageimages|extracts|info", piprop: "original|thumbnail", pithumbsize: "1000",
      exintro: "1", explaintext: "1", inprop: "url", format: "json", origin: "*",
    })) direct.searchParams.set(key, value);
    const response = await fetch(direct, { signal: AbortSignal.timeout(15_000), headers: {
      "User-Agent": "MusicCurator/1.0 (personal library metadata)",
    } });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("json")) throw new Error(`Wikipedia HTTP ${response.status}`);
    const body = await response.json() as { query?: { pages?: Record<string, Page> } };
    const pages = Object.values(body.query?.pages ?? {});
    for (const item of batch) {
      const page = pages.find((candidate) => normalized(candidate.title) === normalized(item.canonicalName!)
        && Boolean(candidate.original ?? candidate.thumbnail));
      const musical = /musician|composer|songwriter|singer|rapper|producer|guitarist|drummer|bassist|keyboardist/i
        .test(page?.extract ?? "");
      batchedResults.push({ ...item, status: page && musical ? "candidate" : "no-exact-evidence", page: page ?? null });
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  console.log(JSON.stringify({ total: pending.length, results: batchedResults }, null, 2));
  return;

  const results: Array<Record<string, unknown>> = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < pending.length) {
      const item = pending[cursor++];
      const query = new URL("https://en.wikipedia.org/w/api.php");
      for (const [key, value] of Object.entries({
        action: "query", generator: "search", gsrsearch: `${item.canonicalName} musician songwriter`,
        gsrlimit: "5", prop: "pageimages|extracts|info", piprop: "original|thumbnail", pithumbsize: "1000",
        exintro: "1", explaintext: "1", inprop: "url", format: "json", origin: "*",
      })) query.searchParams.set(key, value);
      try {
        const response = await fetch(query, { signal: AbortSignal.timeout(12_000), headers: {
          "User-Agent": "MusicCurator/1.0 (personal library metadata)",
        } });
        const body = await response.json() as { query?: { pages?: Record<string, Page> } };
        let pages = Object.values(body.query?.pages ?? {});
        let exact = pages.find((page) => normalized(page.title) === normalized(item.canonicalName!)
          && Boolean(page.original ?? page.thumbnail));
        if (!exact) {
          const direct = new URL("https://en.wikipedia.org/w/api.php");
          for (const [key, value] of Object.entries({
            action: "query", titles: item.canonicalName!, redirects: "1", prop: "pageimages|extracts|info",
            piprop: "original|thumbnail", pithumbsize: "1000", exintro: "1", explaintext: "1",
            inprop: "url", format: "json", origin: "*",
          })) direct.searchParams.set(key, value);
          const directResponse = await fetch(direct, { signal: AbortSignal.timeout(12_000), headers: {
            "User-Agent": "MusicCurator/1.0 (personal library metadata)",
          } });
          const directBody = await directResponse.json() as { query?: { pages?: Record<string, Page> } };
          pages = Object.values(directBody.query?.pages ?? {});
          exact = pages.find((page) => normalized(page.title) === normalized(item.canonicalName!)
            && Boolean(page.original ?? page.thumbnail));
        }
        const evidence = exact?.extract ?? "";
        const musical = /musician|composer|songwriter|singer|rapper|producer|guitarist|drummer|bassist|keyboardist/i.test(evidence);
        results.push({ ...item, status: exact && musical ? "candidate" : "no-exact-evidence", page: exact ?? null });
      } catch (error) {
        results.push({ ...item, status: "failed", message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  await Promise.all(Array.from({ length: 3 }, () => worker()));
  console.log(JSON.stringify({ total: pending.length, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
