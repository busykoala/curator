import { createHash } from "node:crypto";
const knownTextRepairs = new Map([
  ["Gonzalo Juli##n Conde", "Gonzalo Julián Conde"],
]);
export function clean(value: unknown): string {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== "string") return "";
  const cleaned = text.normalize("NFC").replace(/\s+/g, " ").trim();
  if (cleaned.toLowerCase() === "undefined") return "";
  return knownTextRepairs.get(cleaned) ?? cleaned;
}
export function normalized(value: string): string { return clean(value).toLocaleLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
export function albumKey(artist: string, album: string): string { return createHash("sha256").update(`${normalized(artist)}\0${normalized(album)}`).digest("hex"); }
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])); return value; }
export function stableHash(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
export function wordLimit(text: string, max: number): string { return clean(text).split(" ").slice(0, max).join(" "); }
