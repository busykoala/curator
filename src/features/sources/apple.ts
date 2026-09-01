import { cachedJson, fetchJson } from "./cache";
export type AppleResult = { artistName: string; collectionName: string; primaryGenreName?: string; releaseDate?: string; collectionId?: number; trackCount?: number; collectionType?: string };
export function searchApple(artist: string, album: string, entityKey: string): Promise<{ results: AppleResult[] }> { const term = `${artist} ${album}`; return cachedJson("apple", `album-search:${term}`, entityKey, 14, () => fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=5`)); }
