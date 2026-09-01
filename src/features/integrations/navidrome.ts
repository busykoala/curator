import { createHash, randomBytes } from "node:crypto";
import { config } from "@/config";
import { db } from "@/features/db/client";
import { navidromePassword, runtimeSettings } from "@/features/settings/runtime";
import type { PlaylistCandidate, PlaylistDefinition } from "@/features/playlists/types";

type Track = {
  id: string; title: string; artist?: string; album?: string; year?: number;
  track?: number; discNumber?: number; path?: string; playCount?: number;
  played?: string; starred?: string; userRating?: number;
};

function credentials() {
  const settings = runtimeSettings();
  return { username: config.NAVIDROME_USERNAME || settings.navidromeUsername, password: config.NAVIDROME_PASSWORD || navidromePassword() };
}

function auth() {
  const value = credentials();
  const salt = randomBytes(6).toString("hex");
  const token = createHash("md5").update(value.password + salt).digest("hex");
  return new URLSearchParams({ u: value.username, t: token, s: salt, v: "1.16.1", c: "music-curator", f: "json" });
}

async function call(method: string, extra: Array<[string, string]> = []) {
  const query = auth();
  for (const [key, value] of extra) query.append(key, value);
  const url = `${config.NAVIDROME_URL.replace(/\/$/, "")}/rest/${method}.view`;
  const post = query.toString().length > 1800;
  const response = await fetch(post ? url : `${url}?${query}`, {
    method: post ? "POST" : "GET",
    headers: post ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
    body: post ? query : undefined,
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Navidrome returned ${response.status}`);
  const body = await response.json() as { "subsonic-response": Record<string, unknown> };
  const root = body["subsonic-response"];
  if (root.status !== "ok") throw new Error(String((root.error as { message?: string } | undefined)?.message ?? "Navidrome request failed"));
  return root;
}

export function navidromeConfigured() {
  const value = credentials();
  return Boolean(value.username && value.password);
}

async function rawPlaylists() {
  const root = await call("getPlaylists");
  return ((root.playlists as { playlist?: Array<Record<string, unknown>> } | undefined)?.playlist ?? []);
}

export async function navidromePlaylists() {
  if (!navidromeConfigured()) return null;
  return (await rawPlaylists()).map((item) => ({ key: String(item.id), title: String(item.name), subtitle: `${Number(item.songCount ?? 0)} songs`, count: Number(item.songCount ?? 0), year: "", status: "ready", artwork: "", fileId: 0, comment: String(item.comment ?? "") }));
}

export async function navidromePlaylist(id: string) {
  const root = await call("getPlaylist", [["id", id]]);
  const playlist = (root.playlist ?? {}) as Record<string, unknown>;
  const entries = (playlist.entry ?? []) as Track[];
  return { view: "playlists", key: id, title: String(playlist.name ?? "Playlist"), subtitle: `${entries.length} songs`, artwork: "", summary: { artist: "", album: "", year: "", genres: [], styles: [], moods: [], scenes: [], labels: [] }, tracks: entries.map((track, index) => ({ id: 0, navidromeId: track.id, title: track.title, artist: track.artist ?? "", album: track.album ?? "", track: track.track ?? index + 1, disc: track.discNumber ?? 0, year: String(track.year ?? ""), path: track.path ?? "", status: "ready", tags: {}, profile: null, manual: null, profileStatus: "external" })) };
}

export async function navidromeListeningProfile() {
  if (!navidromeConfigured()) return { frequent: [], starred: [] };
  const [frequent, starred] = await Promise.all([call("getAlbumList2", [["type", "frequent"], ["size", "500"]]), call("getStarred2")]);
  return { frequent: ((frequent.albumList2 as { album?: Record<string, unknown>[] } | undefined)?.album ?? []), starred: ((starred.starred2 as { song?: Record<string, unknown>[] } | undefined)?.song ?? []) };
}

const norm = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const pathKey = (value: string) => decodeURIComponent(value).replace(/\\/g, "/").replace(/^\/?music\//, "").replace(/^\/+/, "").toLowerCase();

async function songId(item: PlaylistCandidate): Promise<string | null> {
  const identity = createHash("sha256").update(`${item.title}|${item.artist}|${item.album}`).digest("hex");
  const cached = db().prepare("SELECT song_id FROM navidrome_track_map WHERE file_id=? AND identity_hash=?").get(item.fileId, identity) as { song_id: string } | undefined;
  if (cached) return cached.song_id;
  const root = await call("search3", [["query", item.title], ["artistCount", "0"], ["albumCount", "0"], ["songCount", "50"]]);
  const songs = ((root.searchResult3 as { song?: Track[] } | undefined)?.song ?? []);
  const matches = songs.filter((song) => norm(song.title) === norm(item.title) && norm(song.artist ?? "") === norm(item.artist) && norm(song.album ?? "") === norm(item.album));
  const file = db().prepare("SELECT path FROM files WHERE id=?").get(item.fileId) as { path: string } | undefined;
  const expectedPath = pathKey(file?.path ?? "");
  const pathMatches = expectedPath ? matches.filter((song) => {
    const actual = pathKey(song.path ?? "");
    return actual === expectedPath || actual.endsWith(expectedPath) || expectedPath.endsWith(actual);
  }) : [];
  const match = pathMatches.length === 1 ? pathMatches[0] : matches.length === 1 ? matches[0] : undefined;
  if (!match) return null;
  db().prepare("INSERT INTO navidrome_track_map(file_id,song_id,identity_hash) VALUES (?,?,?) ON CONFLICT(file_id) DO UPDATE SET song_id=excluded.song_id,identity_hash=excluded.identity_hash,verified_at=CURRENT_TIMESTAMP").run(item.fileId, match.id, identity);
  return match.id;
}

export async function unresolvedNavidromeCandidates(items: PlaylistCandidate[]) {
  const unresolved: PlaylistCandidate[] = [];
  for (const item of items) if (!(await songId(item))) unresolved.push(item);
  return unresolved;
}

const marker = (id: number) => `Managed by Music Curator [${id}]`;

export async function replaceManagedPlaylist(definition: PlaylistDefinition, items: PlaylistCandidate[]) {
  if (!navidromeConfigured()) throw new Error("Navidrome admin credentials are not configured");
  const mapped: Array<{ fileId: number; songId: string }> = [];
  for (const item of items) {
    const id = await songId(item);
    if (!id) throw new Error(`Navidrome song identity remains unresolved: ${item.artist} / ${item.album} / ${item.title}`);
    mapped.push({ fileId: item.fileId, songId: id });
  }
  const ids = mapped.map((item) => item.songId);
  const playlists = await rawPlaylists();
  const existing = definition.navidromePlaylistId ? playlists.find((item) => String(item.id) === definition.navidromePlaylistId) : undefined;
  const collision = playlists.find((item) => String(item.name).toLowerCase() === definition.name.toLowerCase() && String(item.id) !== definition.navidromePlaylistId);
  if (collision && !String(collision.comment ?? "").includes(marker(definition.id))) throw new Error(`An unmanaged Navidrome playlist named ${definition.name} already exists`);
  let playlistId = definition.navidromePlaylistId ?? "";
  let previous: string[] = [];
  if (existing) {
    previous = (await navidromePlaylist(String(existing.id))).tracks.map((track) => String(track.navidromeId ?? ""));
    await call("createPlaylist", [["playlistId", String(existing.id)], ...ids.map((id) => ["songId", id] as [string, string])]);
  } else {
    const root = await call("createPlaylist", [["name", definition.name], ...ids.map((id) => ["songId", id] as [string, string])]);
    playlistId = String((root.playlist as { id?: string } | undefined)?.id ?? "");
    if (!playlistId) playlistId = String((await rawPlaylists()).find((item) => String(item.name) === definition.name)?.id ?? "");
    if (!playlistId) throw new Error("Navidrome did not return the created playlist");
  }
  try {
    await call("updatePlaylist", [["playlistId", playlistId], ["name", definition.name], ["comment", marker(definition.id)], ["public", "false"]]);
    const actual = (await navidromePlaylist(playlistId)).tracks.map((track) => String(track.navidromeId ?? ""));
    if (actual.join("|") !== ids.join("|")) throw new Error("Navidrome playlist verification failed");
  } catch (error) {
    if (existing && previous.length) await call("createPlaylist", [["playlistId", playlistId], ...previous.map((id) => ["songId", id] as [string, string])]).catch(() => undefined);
    throw error;
  }
  return { playlistId, tracks: ids.length, songIds: new Map(mapped.map((item) => [item.fileId, item.songId])) };
}

export async function deleteManagedPlaylist(definition: PlaylistDefinition) {
  if (!definition.navidromePlaylistId) return;
  const item = (await rawPlaylists()).find((value) => String(value.id) === definition.navidromePlaylistId);
  if (item && !String(item.comment ?? "").includes(marker(definition.id))) throw new Error("Refusing to delete an unmanaged Navidrome playlist");
  if (item) await call("deletePlaylist", [["id", definition.navidromePlaylistId]]);
}
