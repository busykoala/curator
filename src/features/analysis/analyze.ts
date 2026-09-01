import { db } from "@/features/db/client";
import type { LibraryIssue } from "@/features/contracts/types";
import { clean } from "@/features/scanner/normalize";
export function analyzeFile(fileId: number, key: string, tags: Record<string, unknown>, artwork: unknown[]): LibraryIssue[] {
  const required = [["title", "TITLE"], ["artist", "ARTIST"], ["album", "ALBUM"], ["albumArtist", "ALBUMARTIST"]] as const; const issues: LibraryIssue[] = [];
  for (const [field, label] of required) if (!clean(tags[field])) issues.push({ fileId, albumKey: key, code: `missing_${field}`, severity: "error", message: `${label} is missing` });
  if (!clean(tags.genre)) issues.push({ fileId, albumKey: key, code: "missing_genre", severity: "warning", message: "Genre enrichment is required" });
  if ([tags.title,tags.artist,tags.album,tags.albumArtist,tags.ARTISTDESCRIPTION,tags.ALBUMDESCRIPTION,(tags.extraProperties as Record<string,unknown>|undefined)?.ARTISTDESCRIPTION,(tags.extraProperties as Record<string,unknown>|undefined)?.ALBUMDESCRIPTION].some(value => /#{2,}|\ufffd/.test(clean(value)))) issues.push({ fileId, albumKey: key, code: "censored_metadata", severity: "error", message: "A damaged Unicode value requires deterministic repair or clean re-enrichment" });
  if (!artwork.length) issues.push({ fileId, albumKey: key, code: "missing_embedded_art", severity: "warning", message: "No embedded cover artwork" });
  const database = db(); database.transaction(() => {
    database.prepare("UPDATE issues SET status='resolved',updated_at=CURRENT_TIMESTAMP WHERE file_id=? AND status='open'").run(fileId);
    const insert = database.prepare("INSERT INTO issues(file_id,album_key,code,severity,message) VALUES (?,?,?,?,?)"); for (const issue of issues) insert.run(fileId, key, issue.code, issue.severity, issue.message);
    database.prepare("UPDATE files SET status='analyzed',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(fileId);
  })(); return issues;
}
