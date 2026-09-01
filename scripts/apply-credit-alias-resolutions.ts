import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { centralArtistPath } from "../src/features/artwork/manager";

type Resolution = { inputName: string; canonicalName: string | null; confidence: number };
type Payload = { resolved: Resolution[] };

const sourcePath = process.argv[2] ?? "/app/data/credit-alias-resolutions.json";
const payload = JSON.parse(readFileSync(sourcePath, "utf8")) as Payload;
const applied: Array<{ inputName: string; canonicalName: string }> = [];

for (const item of payload.resolved) {
  if (!item.canonicalName || item.confidence < 0.95 || item.canonicalName === item.inputName) continue;
  const source = centralArtistPath(item.canonicalName);
  const destination = centralArtistPath(item.inputName);
  if (!source || !destination || !existsSync(source) || existsSync(destination)) continue;
  copyFileSync(source, destination);
  applied.push({ inputName: item.inputName, canonicalName: item.canonicalName });
}

console.log(JSON.stringify({ appliedCount: applied.length, applied }, null, 2));
