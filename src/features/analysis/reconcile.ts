import { db } from "@/features/db/client";
import { versions } from "@/config";

type FileRow = {
  id: number;
  album_key: string;
  tags_json: string;
  artwork_json: string;
  desired_hash: string | null;
  status: string;
};

type IssueRow = {
  id: number;
  file_id: number | null;
  album_key: string | null;
  code: string;
};

function parse(value: string): Record<string, unknown> {
  try { return JSON.parse(value) as Record<string, unknown>; }
  catch { return {}; }
}

function present(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(present);
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}

function releaseGroupId(tags: Record<string, unknown>): boolean {
  const containers = [tags, tags.extraProperties].filter(Boolean) as Record<string, unknown>[];
  return containers.some(container => Object.entries(container).some(([key, value]) =>
    key.replace(/[^a-z0-9]/gi, "").toLowerCase() === "musicbrainzreleasegroupid" && present(value)
  ));
}

export function reconcileIssues(): number {
  const database = db();
  const files = database.prepare("SELECT id,album_key,tags_json,artwork_json,desired_hash,status FROM files").all() as FileRow[];
  const byId = new Map(files.map(file => [file.id, file]));
  const byAlbum = new Map<string, FileRow[]>();
  for (const file of files) {
    const group = byAlbum.get(file.album_key) ?? [];
    group.push(file);
    byAlbum.set(file.album_key, group);
  }
  const confirmed = new Set((database.prepare("SELECT album_key FROM manual_overrides WHERE confirmed=1 AND release_group_mbid IS NOT NULL AND trim(release_group_mbid)<>''").all() as {album_key:string}[]).map(row => row.album_key));
  const currentIncomplete = new Set((database.prepare("SELECT p.file_id FROM track_profiles p JOIN files f ON f.id=p.file_id WHERE p.schema_version=? AND p.classifier_version=? AND coalesce(json_extract(p.provenance_json,'$.audioAnalyzer'),0)=? AND p.status IN ('partial','failed') AND f.updated_at<=p.source_updated_at").all(versions.categorizationSchema,versions.categorizationPrompt,versions.audioAnalysis) as {file_id:number}[]).map(row => row.file_id));
  const issues = database.prepare("SELECT id,file_id,album_key,code FROM issues WHERE status='open'").all() as IssueRow[];
  const resolved: number[] = [];
  for (const issue of issues) {
    const file = issue.file_id == null ? undefined : byId.get(issue.file_id);
    const album = issue.album_key ? byAlbum.get(issue.album_key) : undefined;
    if (issue.file_id != null && !file) { resolved.push(issue.id); continue; }
    if (issue.album_key && !album && !file) { resolved.push(issue.id); continue; }
    if (issue.code === "censored_metadata" && file && !/#{2,}|\ufffd/.test(file.tags_json)) resolved.push(issue.id);
    if (issue.code === "missing_albumArtist" && file && present(parse(file.tags_json).albumArtist)) resolved.push(issue.id);
    if (issue.code === "missing_genre" && file && present(parse(file.tags_json).genre)) resolved.push(issue.id);
    if (issue.code === "missing_embedded_art" && file && Object.keys(parse(file.artwork_json)).length > 0) resolved.push(issue.id);
    if (issue.code === "identity_unresolved" && issue.album_key && (confirmed.has(issue.album_key) || album?.some(row => releaseGroupId(parse(row.tags_json))))) resolved.push(issue.id);
    if (issue.code === "processing_deferred" && album?.every(row => row.desired_hash && !["error", "processing"].includes(row.status))) resolved.push(issue.id);
    if (["categorization_partial", "categorization_failed"].includes(issue.code) && issue.file_id != null && !currentIncomplete.has(issue.file_id)) resolved.push(issue.id);
  }
  if (!resolved.length) return 0;
  const update = database.prepare("UPDATE issues SET status='resolved',updated_at=CURRENT_TIMESTAMP WHERE id=?");
  database.transaction(() => { for (const id of new Set(resolved)) update.run(id); })();
  return resolved.length;
}
