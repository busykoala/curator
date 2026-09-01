import OpenAI from "openai";
import { z } from "zod";
import { config } from "@/config";
import { db, stateGet, stateSet } from "@/features/db/client";
import { addMusic, lidarrQueue, searchMusic } from "@/features/integrations/music";
import { targetByAlbum } from "@/features/acquisition/repository";
import { recordAiUsage } from "@/features/ai/usage";

const client = new OpenAI({ apiKey: config.OPENAI_API_KEY || "build-placeholder" });
const candidateSchema = z.object({ lane: z.string(), artist: z.string(), album: z.string(), releaseDate: z.string(), genres: z.array(z.string()).max(4), sources: z.array(z.string().url()).min(1).max(3), rationale: z.string().max(300) });
const outputSchema = z.object({ candidates: z.array(candidateSchema).max(2) });
const jsonSchema = { type: "object", additionalProperties: false, required: ["candidates"], properties: { candidates: { type: "array", maxItems: 2, items: { type: "object", additionalProperties: false, required: ["lane", "artist", "album", "releaseDate", "genres", "sources", "rationale"], properties: { lane: { type: "string" }, artist: { type: "string" }, album: { type: "string" }, releaseDate: { type: "string" }, genres: { type: "array", maxItems: 4, items: { type: "string" } }, sources: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } }, rationale: { type: "string", maxLength: 300 } } } } } } as const;
const norm = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const hoursSince = (value?: string | null) => value ? Math.max(0, (Date.now() - new Date(`${value.replace(" ", "T")}Z`).getTime()) / 3_600_000) : Number.POSITIVE_INFINITY;
const validSource = (value: unknown): value is string => { try { const url = new URL(String(value)); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; } };

type Lane = { name: string; category: string; intent: string; tasteLanes: string[]; genres: string[]; sourceDomains: string[] };
type Candidate = { id: number; lane: string; artist: string; album: string; release_date: string; status: string; lidarr_album_id: number | null; queued_at: string | null; last_search_at: string | null; last_progress_at: string | null; last_size_left: number | null; search_attempts: number };

function lanes(): Lane[] {
  const rows = db().prepare("SELECT name,category,intent,config_json FROM smart_playlists WHERE enabled=1 AND (category='discovery' OR (category='depth' AND json_extract(config_json,'$.externalDiscovery')=1))").all() as Array<{ name: string; category: string; intent: string; config_json: string }>;
  return rows.map((row) => { const value = JSON.parse(row.config_json); return { name: row.name, category: row.category, intent: row.intent, tasteLanes: value.tasteLanes ?? [], genres: value.genres ?? [], sourceDomains: value.sourceDomains ?? [] }; });
}

function matchedLane(value: string, known: Lane[]) {
  const exact = known.find((lane) => norm(lane.name) === norm(value));
  if (exact) return exact;
  return known.find((lane) => [...lane.tasteLanes, ...lane.genres].some((term) => norm(term) === norm(value)));
}

function present(artist: string, album: string) {
  return (db().prepare("SELECT artist_name,album_name FROM files").all() as Array<{ artist_name: string; album_name: string }>).some((file) => norm(file.artist_name) === norm(artist) && norm(file.album_name) === norm(album));
}

async function exactLidarr(artist: string, album: string, date: string) {
  const result = await searchMusic(`${artist} ${album}`) as { albums?: Array<Record<string, unknown> & { artist?: Record<string, unknown> }> };
  const year = Number(date.slice(0, 4));
  const matches = (result.albums ?? []).filter((item) => norm(String(item.title ?? "")) === norm(album) && norm(String(item.artist?.artistName ?? "")) === norm(artist) && (!year || !item.releaseDate || Math.abs(Number(String(item.releaseDate).slice(0, 4)) - year) <= 1));
  if (matches.length !== 1) return null;
  const item = matches[0], artistId = String(item.artist?.foreignArtistId ?? ""), albumId = String(item.foreignAlbumId ?? "");
  return artistId && albumId ? { artistId, albumId } : null;
}

async function queueCandidate(item: Candidate) {
  if (present(item.artist, item.album)) {
    db().prepare("UPDATE discovery_candidates SET status='rejected',message='Album is already in the library',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(item.id);
    return false;
  }
  const match = await exactLidarr(item.artist, item.album, item.release_date ?? "");
  if (!match) {
    db().prepare("UPDATE discovery_candidates SET status='rejected',message='No exact Lidarr album identity',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(item.id);
    return false;
  }
  try {
    const added = await addMusic(match.artistId, [match.albumId], "playlist");
    db().prepare("UPDATE discovery_candidates SET foreign_artist_id=?,foreign_album_id=?,lidarr_artist_id=?,lidarr_album_id=?,status='queued',message='Waiting for Lidarr',queued_at=CURRENT_TIMESTAMP,last_search_at=CURRENT_TIMESTAMP,last_progress_at=CURRENT_TIMESTAMP,last_size_left=NULL,search_attempts=1,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(match.artistId, match.albumId, added.artistId, added.albumIds[0], item.id);
    return true;
  } catch (error) {
    db().prepare("UPDATE discovery_candidates SET status='failed',message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(error), item.id);
    return false;
  }
}

async function queueNext(lane: string) {
  const pending = db().prepare("SELECT * FROM discovery_candidates WHERE lane=? AND status='researched' AND (cooldown_until IS NULL OR cooldown_until<CURRENT_TIMESTAMP) ORDER BY created_at LIMIT 12").all(lane) as Candidate[];
  for (const item of pending) if (await queueCandidate(item)) return true;
  return false;
}

export async function researchDiscovery() {
  const all = lanes().filter((lane) => {
    const row = db().prepare("SELECT count(*) count FROM discovery_candidates WHERE lane=? AND status IN ('researched','queued','downloading')").get(lane.name) as { count: number };
    return Number(row.count) < 2;
  });
  if (!all.length) return { researched: 0, queued: 0 };
  const cursor = Math.max(0, Number(stateGet("playlist_research_cursor") ?? 0)) % all.length;
  const known = Array.from({ length: Math.min(1, all.length) }, (_, index) => all[(cursor + index) % all.length]);
  if (!config.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for editorial discovery");
  const evidence = known.map(({ name, category, intent, tasteLanes, genres, sourceDomains }) => ({ name, category, intent: intent.slice(0, 240), tasteLanes: tasteLanes.slice(0, 6), genres: genres.slice(0, 6), sourceDomains: sourceDomains.slice(0, 5) }));
  const response = await client.responses.create({ model: config.OPENAI_SOL_MODEL, reasoning: { effort: "low" }, tools: [{ type: "web_search", search_context_size: "low" }], max_output_tokens: 2_000, store: false, input: `Use exactly one web search query. Find one or two editorially supported music releases from the last 120 days for each supplied lane. Use exact lane names. Be concise. Favor reputable criticism and labels; reject charts, sponsorship, and unsupported claims. LANES=${JSON.stringify(evidence)}`, text: { format: { type: "json_schema", name: "playlist_discovery", strict: true, schema: jsonSchema } } }, { timeout: 120_000, maxRetries: 0 });
  recordAiUsage("playlist_discovery",config.OPENAI_SOL_MODEL,response);
  const raw = JSON.parse(response.output_text) as { candidates?: Array<Record<string, unknown>> };
  const output = outputSchema.parse({ candidates: (raw.candidates ?? []).map((candidate) => ({
    ...candidate, sources: Array.isArray(candidate.sources) ? candidate.sources.filter(validSource) : [],
  })).filter((candidate) => candidate.sources.length > 0) });
  stateSet("playlist_research_cursor", String((cursor + known.length) % all.length));
  const insert = db().prepare("INSERT INTO discovery_candidates(lane,artist,album,release_date,genres_json,sources_json,rationale) VALUES (?,?,?,?,?,?,?) ON CONFLICT(lane,artist,album) DO UPDATE SET release_date=excluded.release_date,genres_json=excluded.genres_json,sources_json=excluded.sources_json,rationale=excluded.rationale,updated_at=CURRENT_TIMESTAMP");
  let researched = 0;
  for (const item of output.candidates) {
    const lane = matchedLane(item.lane, known);
    if (!lane) continue;
    insert.run(lane.name, item.artist, item.album, item.releaseDate, JSON.stringify(item.genres), JSON.stringify(item.sources), item.rationale);
    researched += 1;
  }
  const active = new Set((db().prepare("SELECT DISTINCT lane FROM discovery_candidates WHERE status IN ('queued','downloading')").all() as Array<{ lane: string }>).map((row) => row.lane));
  let queued = 0;
  for (const lane of known) {
    if (queued >= 3 || active.has(lane.name)) continue;
    if (await queueNext(lane.name)) queued += 1;
  }
  return { researched, queued };
}

function pinImported(item: Candidate) {
  const playlist = db().prepare("SELECT id FROM smart_playlists WHERE lower(name)=lower(?) AND enabled=1").get(item.lane) as { id: number } | undefined;
  if (!playlist) return;
  const file = (db().prepare("SELECT id,artist_name,album_name FROM files ORDER BY id").all() as Array<{ id: number; artist_name: string; album_name: string }>).find((row) => norm(row.artist_name) === norm(item.artist) && norm(row.album_name) === norm(item.album));
  if (!file) return;
  db().prepare("DELETE FROM playlist_feedback WHERE playlist_id=? AND file_id=? AND action='pin' AND expires_at IS NOT NULL").run(playlist.id, file.id);
  db().prepare("INSERT INTO playlist_feedback(playlist_id,file_id,artist,action,expires_at) VALUES (?,?,?,'pin',datetime('now','+14 days'))").run(playlist.id, file.id, file.artist_name);
}

export async function refreshDiscoveryStates() {
  const rows = db().prepare("SELECT * FROM discovery_candidates WHERE status IN ('queued','downloading')").all() as Candidate[];
  if (!rows.length) return { active: 0, imported: 0, abandoned: 0, replaced: 0 };
  const queue = await lidarrQueue();
  const files = db().prepare("SELECT DISTINCT artist_name,album_name FROM files").all() as Array<{ artist_name: string; album_name: string }>;
  let imported = 0;
  for (const row of rows) {
    const exists = files.some((file) => norm(file.artist_name) === norm(row.artist) && norm(file.album_name) === norm(row.album));
    if (exists) {
      db().prepare("UPDATE discovery_candidates SET status='imported',message='Imported and reserved for the next playlist cycle',imported_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
      pinImported(row); imported += 1; continue;
    }
    const matching = queue.filter((item) => item.albumId === row.lidarr_album_id);
    const target=row.lidarr_album_id?targetByAlbum(row.lidarr_album_id):undefined,sizeLeft=matching.reduce((sum,item)=>sum+Number(item.sizeleft??0),0),status=target?.status==="downloading"?"downloading":"queued";
    db().prepare("UPDATE discovery_candidates SET status=?,message=?,last_checked_at=CURRENT_TIMESTAMP,last_size_left=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status,"Acquisition is managed by Curator",matching.length?sizeLeft:row.last_size_left,row.id);
  }
  return { active: rows.length, imported, abandoned: 0, replaced: 0 };
}

export function playlistAwaitingAcquisition(name: string) {
  return db().prepare("SELECT id,artist,album,status,message,queued_at,last_progress_at FROM discovery_candidates WHERE lower(lane)=lower(?) AND status IN ('queued','downloading') ORDER BY queued_at LIMIT 1").get(name) as Record<string, unknown> | undefined;
}
