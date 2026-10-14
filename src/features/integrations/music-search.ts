type Item = Record<string, unknown>;
type SearchDependencies = {
  artists: (term: string) => Promise<Item[]>;
  albums: (term: string) => Promise<Item[]>;
  fallbackAlbums: (term: string) => Promise<Item[]>;
};

export async function searchMusicCatalogue(term: string, dependencies: SearchDependencies) {
  const query = term.trim();
  if (query.length < 2) return { artists: [], albums: [] };
  if (query.length > 200) throw new Error("Please keep your search under 200 characters.");
  const [artistResult, albumResult] = await Promise.allSettled([
    dependencies.artists(query), dependencies.albums(query),
  ]);
  const artists = artistResult.status === "fulfilled" ? artistResult.value : [];
  let albums = albumResult.status === "fulfilled" ? albumResult.value : [];
  let recovered = albumResult.status === "fulfilled";
  if (!recovered && !query.startsWith("lidarr:")) {
    try {
      albums = await dependencies.fallbackAlbums(query);
      recovered = true;
    } catch { /* Keep useful artist results when a catalogue provider is unavailable. */ }
  }
  if (artistResult.status === "rejected" && !recovered) {
    throw new Error("The music catalogue is temporarily unavailable. Please try again shortly.");
  }
  const warning = !recovered
    ? "Album search is temporarily unavailable. You can still browse the artist results or try again shortly."
    : artistResult.status === "rejected"
      ? "Artist search is temporarily unavailable. Album results are available below."
      : "";
  return { artists, albums, warning };
}
