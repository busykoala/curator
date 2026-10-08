import type { PlaylistDefinition } from "./playlist-view-model";
export function playlistStatus(item: PlaylistDefinition) {
  if (item.chatJob?.status === "queued" || item.chatJob?.status === "running")
    return "Creating mix · you can leave";
  if (item.chatJob?.status === "failed") return "Message needs retry";
  if (item.chatJob?.syncError)
    return item.unreadReply
      ? "New reply · Navidrome update failed"
      : "Draft saved · Navidrome update failed";
  if (item.unreadReply) return "New reply";
  if (item.runs?.[0]?.status === "failed") return "Last update failed";
  return item.navidromePlaylistId ? "Saved to Navidrome" : "Draft";
}
