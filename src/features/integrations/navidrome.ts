import { createHash, randomBytes } from "node:crypto";
import { config } from "@/config";
import {
  identityName as norm,
  trackArtistMatches,
  trackAlbumMatches,
  trackPositionMatches,
} from "./navidrome-identity";
import { jellyfinCall } from "@/features/auth/navidrome";
import { db } from "@/features/db/client";
import {
  navidromePassword,
  runtimeSettings,
} from "@/features/settings/runtime";
import type {
  PlaylistCandidate,
  PlaylistDefinition,
} from "@/features/playlists/types";

type Track = {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  year?: number;
  track?: number;
  discNumber?: number;
  path?: string;
  playCount?: number;
  played?: string;
  starred?: string;
  userRating?: number;
};
type JellyItem = {
  Id: string;
  Name?: string;
  Album?: string;
  Artists?: string[];
  Path?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  Overview?: string;
  UserData?: {
    PlayCount?: number;
    LastPlayedDate?: string;
    IsFavorite?: boolean;
    Rating?: number;
  };
};
type JellyItems = { Items?: JellyItem[]; TotalRecordCount?: number };
function credentials() {
  const settings = runtimeSettings();
  return {
    username: config.NAVIDROME_USERNAME || settings.navidromeUsername,
    password: config.NAVIDROME_PASSWORD || navidromePassword(),
  };
}
function auth() {
  const value = credentials(),
    salt = randomBytes(6).toString("hex"),
    token = createHash("md5")
      .update(value.password + salt)
      .digest("hex");
  return new URLSearchParams({
    u: value.username,
    t: token,
    s: salt,
    v: "1.16.1",
    c: "music-curator",
    f: "json",
  });
}
async function call(method: string, extra: Array<[string, string]> = []) {
  const query = auth();
  for (const [key, value] of extra) query.append(key, value);
  const url = `${config.NAVIDROME_URL.replace(/\/$/, "")}/rest/${method}.view`,
    post = query.toString().length > 1800,
    response = await fetch(post ? url : `${url}?${query}`, {
      method: post ? "POST" : "GET",
      headers: post
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : undefined,
      body: post ? query : undefined,
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  if (!response.ok) throw new Error(`Navidrome returned ${response.status}`);
  const body = (await response.json()) as {
      "subsonic-response": Record<string, unknown>;
    },
    root = body["subsonic-response"];
  if (root.status !== "ok")
    throw new Error(
      String(
        (root.error as { message?: string } | undefined)?.message ??
          "Navidrome request failed",
      ),
    );
  return root;
}
export function navidromeConfigured() {
  const value = credentials();
  return Boolean(value.username && value.password);
}
async function rawPlaylists() {
  const root = await call("getPlaylists");
  return (
    (
      root.playlists as
        | { playlist?: Array<Record<string, unknown>> }
        | undefined
    )?.playlist ?? []
  );
}
export async function navidromePlaylists() {
  if (!navidromeConfigured()) return null;
  return (await rawPlaylists()).map((item) => ({
    key: String(item.id),
    title: String(item.name),
    subtitle: `${Number(item.songCount ?? 0)} songs`,
    count: Number(item.songCount ?? 0),
    year: "",
    status: "ready",
    artwork: "",
    fileId: 0,
    comment: String(item.comment ?? ""),
  }));
}
export async function navidromePlaylist(id: string) {
  const root = await call("getPlaylist", [["id", id]]),
    playlist = (root.playlist ?? {}) as Record<string, unknown>,
    entries = (playlist.entry ?? []) as Track[];
  return {
    view: "playlists",
    key: id,
    title: String(playlist.name ?? "Playlist"),
    subtitle: `${entries.length} songs`,
    artwork: "",
    summary: {
      artist: "",
      album: "",
      year: "",
      genres: [],
      styles: [],
      moods: [],
      scenes: [],
      labels: [],
    },
    tracks: entries.map((track, index) => ({
      id: 0,
      navidromeId: track.id,
      title: track.title,
      artist: track.artist ?? "",
      album: track.album ?? "",
      track: track.track ?? index + 1,
      disc: track.discNumber ?? 0,
      year: String(track.year ?? ""),
      path: track.path ?? "",
      status: "ready",
      tags: {},
      profile: null,
      manual: null,
      profileStatus: "external",
    })),
  };
}

export async function navidromeListeningProfile(userId?: number) {
  if (userId) {
    const [frequent, starred] = await Promise.all([
      jellyfinCall<JellyItems>(
        userId,
        "Items?IncludeItemTypes=Audio&Recursive=true&SortBy=PlayCount&SortOrder=Descending&Limit=500&Fields=UserData",
      ),
      jellyfinCall<JellyItems>(
        userId,
        "Items?IncludeItemTypes=Audio&Recursive=true&Filters=IsFavorite&Limit=500&Fields=UserData",
      ),
    ]);
    return {
      frequent: (frequent.Items ?? []).map((item) => ({
        artist: item.Artists?.[0] ?? "",
        name: item.Album ?? "",
        playCount: item.UserData?.PlayCount ?? 0,
        played: item.UserData?.LastPlayedDate ?? "",
      })),
      starred: (starred.Items ?? []).map((item) => ({
        title: item.Name ?? "",
        artist: item.Artists?.[0] ?? "",
        album: item.Album ?? "",
      })),
    };
  }
  if (!navidromeConfigured()) return { frequent: [], starred: [] };
  const [frequent, starred] = await Promise.all([
    call("getAlbumList2", [
      ["type", "frequent"],
      ["size", "500"],
    ]),
    call("getStarred2"),
  ]);
  return {
    frequent:
      (frequent.albumList2 as { album?: Record<string, unknown>[] } | undefined)
        ?.album ?? [],
    starred:
      (starred.starred2 as { song?: Record<string, unknown>[] } | undefined)
        ?.song ?? [],
  };
}

const pathKey = (value: string) =>
  decodeURIComponent(value)
    .replace(/\\/g, "/")
    .replace(/^\/?music\//, "")
    .replace(/^\/+/, "")
    .toLowerCase();
async function jellyfinSongId(
  item: PlaylistCandidate,
  userId: number,
  refresh = false,
) {
  const cached = db()
    .prepare("SELECT jellyfin_song_id FROM navidrome_track_map WHERE file_id=?")
    .get(item.fileId) as { jellyfin_song_id: string | null } | undefined;
  if (cached?.jellyfin_song_id && !refresh) return cached.jellyfin_song_id;
  const file = db()
    .prepare("SELECT path,tags_json FROM files WHERE id=?")
    .get(item.fileId) as { path: string; tags_json: string } | undefined;
  const tags = JSON.parse(file?.tags_json ?? "{}") as Record<string, unknown>;
  const search = async (query: string, limit: number) =>
    (
      await jellyfinCall<JellyItems>(
        userId,
        `Items?IncludeItemTypes=Audio&Recursive=true&SearchTerm=${encodeURIComponent(query)}&Limit=${limit}&Fields=Path`,
      )
    ).Items ?? [];
  const matching = (songs: JellyItem[]) =>
    songs.filter(
      (song) =>
        norm(song.Name ?? "") === norm(item.title) &&
        trackArtistMatches(song.Artists ?? [], item.artist, tags.artist) &&
        trackAlbumMatches(song.Album ?? "", item.album, tags.album),
    );
  const titleResults = await search(item.title, 50);
  let matches = matching(titleResults);
  // Navidrome ignores very short search terms; the file's exact album tag also
  // narrows broad title searches while all identity checks still apply.
  if (!matches.length || titleResults.length === 50) {
    const album = Array.isArray(tags.album) ? tags.album[0] : tags.album;
    matches = matching(
      await search(norm(item.artist + " " + String(album || item.album)), 200),
    );
  }
  const expected = pathKey(file?.path ?? "");
  const pathMatches = expected
    ? matches.filter((song) => {
        const actual = pathKey(song.Path ?? "");
        return (
          Boolean(actual) &&
          (actual === expected ||
            actual.endsWith(expected) ||
            expected.endsWith(actual))
        );
      })
    : [];
  const positions = matches.filter((song) =>
    trackPositionMatches(tags, song.IndexNumber, song.ParentIndexNumber),
  );
  const match =
    pathMatches.length === 1
      ? pathMatches[0]
      : matches.length === 1
        ? matches[0]
        : positions.length === 1
          ? positions[0]
          : undefined;
  if (!match) return null;
  db()
    .prepare(
      "INSERT INTO navidrome_track_map(file_id,song_id,identity_hash,jellyfin_song_id) VALUES (?,?,?,?) ON CONFLICT(file_id) DO UPDATE SET jellyfin_song_id=excluded.jellyfin_song_id,verified_at=CURRENT_TIMESTAMP",
    )
    .run(
      item.fileId,
      "",
      createHash("sha256")
        .update(`${item.title}|${item.artist}|${item.album}`)
        .digest("hex"),
      match.Id,
    );
  return match.Id;
}
async function subsonicSongId(item: PlaylistCandidate, refresh = false) {
  const identity = createHash("sha256")
      .update(`${item.title}|${item.artist}|${item.album}`)
      .digest("hex"),
    cached = db()
      .prepare(
        "SELECT song_id FROM navidrome_track_map WHERE file_id=? AND identity_hash=?",
      )
      .get(item.fileId, identity) as { song_id: string } | undefined;
  if (cached?.song_id && !refresh) return cached.song_id;
  const root = await call("search3", [
      ["query", item.title],
      ["artistCount", "0"],
      ["albumCount", "0"],
      ["songCount", "50"],
    ]),
    songs = (root.searchResult3 as { song?: Track[] } | undefined)?.song ?? [],
    file = db()
      .prepare("SELECT path,tags_json FROM files WHERE id=?")
      .get(item.fileId) as { path: string; tags_json: string } | undefined,
    tags = JSON.parse(file?.tags_json ?? "{}") as Record<string, unknown>,
    matches = songs.filter(
      (song) =>
        norm(song.title) === norm(item.title) &&
        trackArtistMatches([song.artist ?? ""], item.artist, tags.artist) &&
        trackAlbumMatches(song.album ?? "", item.album, tags.album),
    ),
    expected = pathKey(file?.path ?? ""),
    pathMatches = expected
      ? matches.filter((song) => {
          const actual = pathKey(song.path ?? "");
          return (
            actual === expected ||
            actual.endsWith(expected) ||
            expected.endsWith(actual)
          );
        })
      : [],
    match =
      pathMatches.length === 1
        ? pathMatches[0]
        : matches.length === 1
          ? matches[0]
          : undefined;
  if (!match) return null;
  db()
    .prepare(
      "INSERT INTO navidrome_track_map(file_id,song_id,identity_hash) VALUES (?,?,?) ON CONFLICT(file_id) DO UPDATE SET song_id=excluded.song_id,identity_hash=excluded.identity_hash,verified_at=CURRENT_TIMESTAMP",
    )
    .run(item.fileId, match.id, identity);
  return match.id;
}
export async function unresolvedNavidromeCandidates(
  items: PlaylistCandidate[],
  userId?: number,
) {
  const unresolved: PlaylistCandidate[] = [];
  for (const item of items)
    if (
      !(userId
        ? await jellyfinSongId(item, userId)
        : await subsonicSongId(item))
    )
      unresolved.push(item);
  return unresolved;
}
const marker = (id: number) => `Managed by Music Curator [${id}]`;

async function jellyfinPlaylistItems(userId: number, id: string) {
  return (
    (await jellyfinCall<JellyItems>(userId, `Playlists/${id}/Items`)).Items ??
    []
  );
}
async function verifiedJellyfinIds(
  userId: number,
  id: string,
  expected: string[],
) {
  let actual: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    actual = (await jellyfinPlaylistItems(userId, id)).map((item) => item.Id);
    if (
      actual.length === expected.length &&
      actual.every((value, index) => value === expected[index])
    )
      return actual;
    if (attempt < 2)
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return actual;
}

async function replaceUserPlaylist(
  definition: PlaylistDefinition,
  items: PlaylistCandidate[],
) {
  const userId = definition.ownerUserId,
    mapped: Array<{ fileId: number; songId: string }> = [];
  for (const item of items) {
    const id = await jellyfinSongId(item, userId);
    if (!id)
      throw new Error(
        `Navidrome song identity remains unresolved: ${item.artist} / ${item.album} / ${item.title}`,
      );
    mapped.push({ fileId: item.fileId, songId: id });
  }
  const ids = mapped.map((item) => item.songId);
  const listed = await jellyfinCall<JellyItems>(
      userId,
      "Items?IncludeItemTypes=Playlist&Recursive=true&Limit=1000&Fields=Overview",
    ),
    playlists = listed.Items ?? [];
  let existing = definition.navidromePlaylistId
    ? playlists.find((item) => item.Id === definition.navidromePlaylistId)
    : undefined;
  if (
    !existing &&
    definition.navidromePlaylistId &&
    !/^[a-f0-9]{32}$/i.test(definition.navidromePlaylistId)
  )
    existing = playlists.find(
      (item) => norm(item.Name ?? "") === norm(definition.name),
    );
  if (!existing)
    existing = playlists.find(
      (item) =>
        norm(item.Name ?? "") === norm(definition.name) &&
        String(item.Overview ?? "").includes(marker(definition.id)),
    );
  const collision = playlists.find(
    (item) =>
      norm(item.Name ?? "") === norm(definition.name) &&
      item.Id !== existing?.Id,
  );
  if (collision)
    throw new Error(
      `An unmanaged Navidrome playlist named ${definition.name} already exists`,
    );
  let playlistId = existing?.Id ?? "",
    previous: string[] = [];
  if (existing) {
    previous = (await jellyfinPlaylistItems(userId, playlistId)).map(
      (item) => item.Id,
    );
    await jellyfinCall(userId, `Playlists/${playlistId}`, {
      method: "POST",
      body: JSON.stringify({
        Name: definition.name,
        Ids: ids,
        IsPublic: false,
      }),
    });
  } else {
    const created = await jellyfinCall<{ Id?: string }>(userId, "Playlists", {
      method: "POST",
      body: JSON.stringify({
        Name: definition.name,
        Ids: ids,
        IsPublic: false,
      }),
    });
    playlistId = created.Id ?? "";
    if (!playlistId)
      throw new Error("Navidrome did not return the created playlist");
  }
  try {
    const actual = await verifiedJellyfinIds(userId, playlistId, ids);
    if (
      actual.length !== ids.length ||
      actual.some((value, index) => value !== ids[index])
    )
      throw new Error(
        `Navidrome playlist verification failed: expected ${ids.length} tracks, received ${actual.length}`,
      );
  } catch (error) {
    if (existing)
      await jellyfinCall(userId, `Playlists/${playlistId}`, {
        method: "POST",
        body: JSON.stringify({
          Name: definition.name,
          Ids: previous,
          IsPublic: false,
        }),
      }).catch(() => undefined);
    throw error;
  }
  return {
    playlistId,
    tracks: ids.length,
    songIds: new Map(mapped.map((item) => [item.fileId, item.songId])),
  };
}

export async function replaceManagedPlaylist(
  definition: PlaylistDefinition,
  items: PlaylistCandidate[],
) {
  if (definition.ownerUserId) return replaceUserPlaylist(definition, items);
  throw new Error("Playlist owner must sign in to Navidrome again");
}
export async function deleteManagedPlaylist(definition: PlaylistDefinition) {
  if (!definition.navidromePlaylistId) return;
  if (!definition.ownerUserId)
    throw new Error("Playlist owner must sign in to Navidrome again");
  await jellyfinCall(
    definition.ownerUserId,
    `Items/${definition.navidromePlaylistId}`,
    { method: "DELETE" },
  );
}

export async function nativeAlbumForFile(fileId: number) {
  const row = db()
    .prepare("SELECT artist_name,album_name,tags_json FROM files WHERE id=?")
    .get(fileId) as
    | { artist_name: string; album_name: string; tags_json: string }
    | undefined;
  if (!row) return null;
  const candidate = {
    fileId,
    title: String((JSON.parse(row.tags_json).title ?? [])[0] ?? ""),
    artist: row.artist_name,
    album: row.album_name,
  } as PlaylistCandidate;
  const tags = JSON.parse(row.tags_json);
  candidate.title = Array.isArray(tags.title)
    ? tags.title[0]
    : (tags.title ?? "");
  const id = await subsonicSongId(candidate);
  if (!id) return null;
  const root = await call("getSong", [["id", id]]);
  return (root.song as { albumId?: string } | undefined)?.albumId ?? null;
}
