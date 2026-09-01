import { playlistSuggestions } from "./clusters";
import { ensurePlaylist, listPlaylists } from "./repository";

export async function ensureAutomaticPlaylists() {
  const { suggestions } = await playlistSuggestions();
  const depth = suggestions
    .filter((item) => item.category === "depth")
    .slice(0, 3);
  const rediscovery = suggestions.find(
    (item) => item.category === "rediscovery",
  );
  const defaults = rediscovery ? [...depth, rediscovery] : depth;
  let created = 0;

  for (const item of defaults) {
    if (ensurePlaylist({ ...item, enabled: true })) created += 1;
  }

  const names = new Set(defaults.map((item) => item.name));
  const active = listPlaylists().filter((item) => names.has(item.name));
  return { created, total: active.length, names: [...names] };
}
