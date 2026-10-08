import { config } from "@/config";
import { db } from "@/features/db/client";
import { dashboardData } from "@/features/playlists/repository";
import { listenerRequests } from "@/features/music/requests";
export function homeData(userId: number) {
  const definitions = dashboardData(userId).definitions;
  const continueMixes = [...definitions]
    .sort((a, b) => {
      const priority = (item: typeof a) =>
        item.unreadReply
          ? 3
          : item.chatJob &&
              (item.chatJob as { status: string }).status.match(
                /queued|running/,
              )
            ? 2
            : !item.navidromePlaylistId
              ? 1
              : 0;
      return (
        priority(b) - priority(a) ||
        String(b.updatedAt).localeCompare(String(a.updatedAt))
      );
    })
    .slice(0, 2)
    .map((item) => ({
      ...item,
      artworkFileId:
        (
          db()
            .prepare(
              "SELECT file_id FROM playlist_items WHERE playlist_id=? ORDER BY run_id DESC,position LIMIT 1",
            )
            .get(item.id) as { file_id: number } | undefined
        )?.file_id ?? null,
    }));
  const fresh = db()
    .prepare(
      "SELECT min(id) fileId,album_key albumKey,min(artist_name) artist,min(album_name) album,max(updated_at) updatedAt FROM files WHERE status='written' GROUP BY album_key ORDER BY max(updated_at) DESC LIMIT 4",
    )
    .all();
  return {
    playlistCount: definitions.length,
    continueMixes,
    fresh,
    requests: listenerRequests(userId)
      .filter((item) => item.status !== "added")
      .slice(0, 4),
    libraryTracks: (
      db().prepare("SELECT count(*) count FROM files").get() as {
        count: number;
      }
    ).count,
    navidromePublicUrl: config.NAVIDROME_PUBLIC_URL,
  };
}
