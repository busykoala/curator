import { config } from "@/config";
import { upsertTarget } from "@/features/acquisition/repository";
import type { TargetOrigin } from "@/features/acquisition/types";

async function request(path: string, init: RequestInit = {}) {
  return fetch(`${config.LIDARR_URL}/api/v1${path}`, {
    ...init,
    headers: { "X-Api-Key": config.LIDARR_API_KEY, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await request(path, init);
  if (!response.ok) throw new Error(`Lidarr ${path} failed (${response.status}): ${await response.text()}`);
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
  if (term.trim().length < 2) return { artists: [], albums: [] };
  const [artists, albums] = await Promise.all([lookupArtists(term), lookupAlbums(term)]);
  return { artists, albums };
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
    const response = await request("/artist", { method: "POST", body: JSON.stringify({ ...candidate, ...settings, monitored: true, addOptions: { monitor: "none", searchForMissingAlbums: false } }) });
    if (!response.ok) throw new Error(`Lidarr add failed (${response.status}): ${await response.text()}`);
    artistId = (await response.json() as { id: number }).id;
  } else if (existing && !existing.monitored) {
    await json(`/artist/${artistId}`, {
      method: "PUT",
      body: JSON.stringify({ ...existing, monitored: true }),
    });
  }
  const albums = await json<LidarrAlbum[]>(`/album?artistId=${artistId}`);
  const selected = albums.filter((album) => albumForeignIds.includes(String(album.foreignAlbumId)));
  if (!selected.length) throw new Error("The selected album was not available after adding the artist");
  const monitored = await Promise.all(selected.map(ensureAlbumMonitored));
  const artist = await json<Record<string, unknown> & { monitored?: boolean }>(`/artist/${artistId}`);
  if (!artist.monitored) {
    await json(`/artist/${artistId}`, {
      method: "PUT",
      body: JSON.stringify({ ...artist, monitored: true }),
    });
  }
  for (const album of monitored) upsertTarget({ albumId: album.id, artistId, origin, artist: String((album.artist as { artistName?: string } | undefined)?.artistName ?? ""), title: String(album.title ?? "") });
  return { artistId, albumIds: monitored.map((album) => album.id), selectedAlbums: monitored.length, alreadyPresent: Boolean(existing), searchQueued: false, controllerQueued: true };
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
