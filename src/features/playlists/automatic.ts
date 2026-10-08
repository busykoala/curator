import { playlistSuggestions } from "./clusters";
import { ensurePlaylist, listPlaylists, removeUnusedAutomaticPlaylists } from "./repository";

export async function ensureAutomaticPlaylists(ownerUserId?: number) {
  if (!ownerUserId) return { created: 0, removed: 0, total: 0, names: [] as string[] };
  const { suggestions } = await playlistSuggestions(ownerUserId);
  const depth = suggestions
    .filter((item) => item.category === "depth")
    .slice(0, 3);
  const rediscovery = suggestions.find(
    (item) => item.category === "rediscovery",
  );
  const defaults = rediscovery ? [...depth, rediscovery] : depth;
  let created = 0;

  for (const item of defaults) {
    if (ensurePlaylist({ ...item, enabled: true, ownerUserId }, String(item.key))) created += 1;
  }

  const names = new Set(defaults.map((item) => String(item.name)));
  const removed = removeUnusedAutomaticPlaylists(ownerUserId, new Set(defaults.map(item => String(item.key))));
  const active = listPlaylists(ownerUserId).filter((item) => item.automatic);
  return { created, removed, total: active.length, names: [...names] };
}
