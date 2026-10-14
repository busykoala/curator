import { config } from "@/config";
import { upsertTarget } from "@/features/acquisition/repository";
import type { TargetOrigin } from "@/features/acquisition/types";
import { searchCatalogueReleaseGroups } from "@/features/sources/musicbrainz";
import { searchMusicCatalogue } from "./music-search";

class MusicServiceError extends Error {
  constructor(public status: number) { super(`Lidarr request failed (${status})`); }
}

export function musicRequestError(error: unknown) {
  if (error instanceof MusicServiceError || (error instanceof Error && ["TimeoutError", "AbortError", "TypeError"].includes(error.name)))
    return "The music service is temporarily unavailable. Please try again shortly.";
  return error instanceof Error ? error.message : "The music request could not be completed. Please try again.";
}

async function request(path: string, init: RequestInit = {}) {
  return fetch(`${config.LIDARR_URL}/api/v1${path}`, {
    ...init,
    headers: { "X-Api-Key": config.LIDARR_API_KEY, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await request(path, init);
  if (!response.ok) throw new MusicServiceError(response.status);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function lookupArtists(term: string) {
  return json<Array<Record<string, unknown>>>(`/artist/lookup?term=${encodeURIComponent(term.trim())}`);
}

async function lookupAlbums(term: string) {
  return json<Array<Record<string, unknown>>>(`/album/lookup?term=${encodeURIComponent(term.trim())}`);
}

type LidarrAlbum = Record<string, unknown> & {
  id: number;
  foreignAlbumId?: string;
  monitored?: boolean;
  statistics?: { trackCount?: number };
};

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function ensureAlbumMonitored(album: LidarrAlbum) {
  let current = album;
  // A newly-created artist is refreshed asynchronously. Updating an album
  // before that refresh has populated its tracks can be silently overwritten
  // by Lidarr's initial monitor-none policy.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (Number(current.statistics?.trackCount ?? 0) > 0) break;
    await wait(1_000);
    current = await json<LidarrAlbum>(`/album/${album.id}`);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!current.monitored) {
      current = await json<LidarrAlbum>(`/album/${album.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...current, monitored: true }),
      });
    }
    await wait(1_000);
    current = await json<LidarrAlbum>(`/album/${album.id}`);
    if (current.monitored) return current;
  }
  throw new Error(`Lidarr did not retain monitoring for album ${album.id}`);
}

export async function searchMusic(term: string): Promise<unknown> {
  return searchMusicCatalogue(term, {
    artists: lookupArtists,
    albums: lookupAlbums,
    fallbackAlbums: async (query) => {
      const candidates = (await searchCatalogueReleaseGroups(query))["release-groups"];
      const lookups = await Promise.allSettled(candidates.map(candidate => lookupAlbums(`lidarr:${candidate.id}`)));
      const albums = new Map<string, Record<string, unknown>>();
      for (const result of lookups) if (result.status === "fulfilled") for (const album of result.value)
        if (album.foreignAlbumId) albums.set(String(album.foreignAlbumId), album);
      if (candidates.length && !albums.size) throw new Error("Exact album lookups are unavailable");
      return [...albums.values()];
    },
  });
}

async function defaults() {
  const artists = await json<Array<{ rootFolderPath: string; qualityProfileId: number; metadataProfileId: number }>>("/artist");
  if (artists.length) {
    const frequency = <T extends string | number>(values: T[]) => [...new Set(values)].sort((a, b) => values.filter((value) => value === b).length - values.filter((value) => value === a).length)[0];
    return { rootFolderPath: frequency(artists.map((item) => item.rootFolderPath)), qualityProfileId: frequency(artists.map((item) => item.qualityProfileId)), metadataProfileId: frequency(artists.map((item) => item.metadataProfileId)) };
  }
  const [roots, quality, metadata] = await Promise.all([json<Array<{ path: string }>>("/rootfolder"), json<Array<{ id: number }>>("/qualityprofile"), json<Array<{ id: number }>>("/metadataprofile")]);
  return { rootFolderPath: roots.find((item) => item.path === "/data/library")?.path ?? roots[0].path, qualityProfileId: quality[0].id, metadataProfileId: metadata[0].id };
}

export async function addMusic(foreignArtistId: string, albumForeignIds: string[], origin: TargetOrigin = "user") {
  if (!albumForeignIds.length) throw new Error("Choose at least one album");
  const current = await json<Array<Record<string, unknown> & { id: number; foreignArtistId?: string; monitored?: boolean }>>("/artist");
  const existing = current.find((item) => item.foreignArtistId === foreignArtistId);
  let artistId = existing?.id;
  if (!artistId) {
    const found = await lookupArtists(`lidarr:${foreignArtistId}`);
    const candidate = found.find((item) => item.foreignArtistId === foreignArtistId);
    if (!candidate) throw new Error("Artist was not found in Lidarr lookup");
    const settings = await defaults();
    const added = await json<{id:number}>("/artist", { method: "POST", body: JSON.stringify({ ...candidate, ...settings, monitored: true, addOptions: { monitor: "none", searchForMissingAlbums: false } }) });
    artistId = added.id;
  } else if (existing && !existing.monitored) {
    await json(`/artist/${artistId}`, {
      method: "PUT",
      body: JSON.stringify({ ...existing, monitored: true }),
    });
  }
  let selected: LidarrAlbum[] = [];
  // Artist creation returns before its initial catalogue refresh finishes.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const albums = await json<LidarrAlbum[]>(`/album?artistId=${artistId}`);
    selected = albums.filter((album) => albumForeignIds.includes(String(album.foreignAlbumId)));
    if (new Set(selected.map(album => album.foreignAlbumId)).size === new Set(albumForeignIds).size) break;
    await wait(1_000);
  }
  if (new Set(selected.map(album => album.foreignAlbumId)).size !== new Set(albumForeignIds).size)
    throw new Error("The selected release is not available in the artist's catalogue yet. Please try again shortly.");
  const monitored = await Promise.all(selected.map(ensureAlbumMonitored));
  const artist = await json<Record<string, unknown> & { monitored?: boolean }>(`/artist/${artistId}`);
  if (!artist.monitored) {
    await json(`/artist/${artistId}`, {
      method: "PUT",
      body: JSON.stringify({ ...artist, monitored: true }),
    });
  }
  for (const album of monitored) upsertTarget({ albumId: album.id, artistId, origin, artist: String((album.artist as { artistName?: string } | undefined)?.artistName ?? ""), title: String(album.title ?? "") });
  return { artistId, albumIds: monitored.map((album) => album.id), albums: monitored.map((album)=>({id:album.id,foreignAlbumId:String(album.foreignAlbumId??""),artist:String((album.artist as {artistName?:string}|undefined)?.artistName??""),title:String(album.title??"")})), selectedAlbums: monitored.length, alreadyPresent: Boolean(existing), searchQueued: false, controllerQueued: true };
}

export type LidarrQueueItem = {
  id: number; albumId?: number; artistId?: number; title?: string; status?: string;
  trackedDownloadStatus?: string; size?: number; sizeleft?: number; errorMessage?: string; downloadId?: string;
};

export async function lidarrQueue(): Promise<LidarrQueueItem[]> {
  const result = await json<{ records?: LidarrQueueItem[] }>("/queue?page=1&pageSize=1000&includeUnknownArtistItems=true");
  return result.records ?? [];
}

export async function searchLidarrAlbums(albumIds: number[]) {
  if (!albumIds.length) return;
  await json("/command", { method: "POST", body: JSON.stringify({ name: "AlbumSearch", albumIds }) });
}

export async function abandonLidarrAlbum(albumId: number, queue?: LidarrQueueItem[]) {
  const matching = (queue ?? await lidarrQueue()).filter((item) => item.albumId === albumId);
  for (const item of matching) {
    await json(`/queue/${item.id}?removeFromClient=true&blocklist=true&skipRedownload=false&changeCategory=false`, { method: "DELETE" });
  }
  return { removed: matching.length, albumId };
}
