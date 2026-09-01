import { readFile, stat, utimes } from "node:fs/promises";
import path from "node:path";

const listPath = process.argv[2];
if (!listPath) throw new Error("Usage: node touch-navidrome-paths.mjs <path-list>");

let touched = 0;
let missing = 0;
for (const relative of (await readFile(listPath, "utf8")).split(/\r?\n/).filter(Boolean)) {
  const target = path.resolve("/music", relative);
  if (!target.startsWith("/music/")) throw new Error(`Unsafe path: ${relative}`);
  try {
    await stat(target);
    const now = new Date();
    await utimes(target, now, now);
    touched++;
  } catch (error) {
    if (error?.code === "ENOENT") missing++;
    else throw error;
  }
}
console.log(JSON.stringify({ touched, missing }));
