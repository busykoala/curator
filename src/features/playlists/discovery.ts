import { z } from "zod";
import { db } from "@/features/db/client";
import { searchMusic } from "@/features/integrations/music";
import { searchReleaseGroups } from "@/features/sources/musicbrainz";

const candidateSchema = z.object({ lane: z.string(), artist: z.string(), album: z.string(), releaseDate: z.string(), genres: z.array(z.string()).max(4), sources: z.array(z.string().url()).min(1).max(3), rationale: z.string().max(300) });
export const playlistDiscoveryOutputSchema = z.object({ candidates: z.array(candidateSchema).max(2) });
export const playlistDiscoveryJsonSchema = { type: "object", additionalProperties: false, required: ["candidates"], properties: { candidates: { type: "array", maxItems: 2, items: { type: "object", additionalProperties: false, required: ["lane", "artist", "album", "releaseDate", "genres", "sources", "rationale"], properties: { lane: { type: "string" }, artist: { type: "string" }, album: { type: "string" }, releaseDate: { type: "string" }, genres: { type: "array", maxItems: 4, items: { type: "string" } }, sources: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } }, rationale: { type: "string", maxLength: 300 } } } } } } as const;
const norm = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const validSource = (value: unknown): value is string => { try { const url = new URL(String(value)); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; } };
export function validatedDiscoveryOutput(raw:{candidates?:Array<Record<string,unknown>>},sourceUrls:Set<string>|undefined,earliestBoundary:number,latestBoundary:number){
  const candidates=(raw.candidates??[])
    .map((candidate):Record<string,unknown>&{sources:string[]}=>({...candidate,sources:Array.isArray(candidate.sources)?candidate.sources.filter((source):source is string=>validSource(source)&&(!sourceUrls||sourceUrls.has(String(source)))):[]}))
    .filter((candidate)=>{const released=Date.parse(String(candidate.releaseDate));return candidate.sources.length>0&&Number.isFinite(released)&&released>=earliestBoundary&&released<=latestBoundary});
  return playlistDiscoveryOutputSchema.parse({candidates});
}

type DiscoveryIdentityDependencies = {
  searchMusic: typeof searchMusic;
  searchReleaseGroups: typeof searchReleaseGroups;
};

export async function resolveDiscoveryIdentity(artist: string, album: string, date: string, dependencies: DiscoveryIdentityDependencies = { searchMusic, searchReleaseGroups }) {
  const year = Number(date.slice(0, 4));
  const matchesFor = (result: unknown) => {
    const albums = (result as { albums?: Array<Record<string, unknown> & { artist?: Record<string, unknown> }> }).albums ?? [];
    return albums.filter((item) => norm(String(item.title ?? "")) === norm(album) && norm(String(item.artist?.artistName ?? "")) === norm(artist) && (!year || !item.releaseDate || Math.abs(Number(String(item.releaseDate).slice(0, 4)) - year) <= 1));
  };
  let matches = matchesFor(await dependencies.searchMusic(`${artist} ${album}`));
  if (matches.length !== 1) {
    const result = await dependencies.searchReleaseGroups(artist, album, `discovery:${norm(artist)}|${norm(album)}`);
    const releaseGroups = result["release-groups"].filter((item) => {
      const creditedArtist = (item["artist-credit"] ?? []).map((credit) => `${credit.name ?? credit.artist.name}${(credit as typeof credit & { joinphrase?: string }).joinphrase ?? ""}`).join("");
      const releaseYear = Number(String(item["first-release-date"] ?? "").slice(0, 4));
      return norm(item.title) === norm(album) && norm(creditedArtist) === norm(artist) && Number(item.score ?? 0) >= 90 && (!year || !releaseYear || Math.abs(releaseYear - year) <= 1);
    });
    if (releaseGroups.length !== 1) return null;
    matches = matchesFor(await dependencies.searchMusic(`lidarr:${releaseGroups[0].id}`));
  }
  if (matches.length !== 1) return null;
  const item = matches[0], artistId = String(item.artist?.foreignArtistId ?? ""), albumId = String(item.foreignAlbumId ?? "");
  return artistId && albumId ? { artistId, albumId } : null;
}

export {refreshDiscoveryLifecycle as refreshDiscoveryStates} from './discovery-lifecycle';
export {researchDiscoveryPools as researchDiscovery} from './discovery-research';
export function playlistAwaitingAcquisition(playlistId:number,ownerId:number){
  return db().prepare("SELECT d.id,r.artist,r.album,d.status,d.message,d.queued_at,d.last_progress_at FROM playlist_discovery_recommendations d JOIN playlist_discovery_releases r ON r.id=d.release_id WHERE d.playlist_id=? AND d.owner_user_id=? AND d.status IN ('queued','downloading') ORDER BY d.queued_at LIMIT 1").get(playlistId,ownerId) as Record<string,unknown>|undefined;
}
