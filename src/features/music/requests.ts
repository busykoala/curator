import { db } from "@/features/db/client";

export type MusicRequest = {
  id: number;
  artist: string;
  album: string;
  foreignAlbumId: string;
  status: string;
  detail: string;
  albumKey: string | null;
  updatedAt: string;
};
export function listenerRequests(userId: number): MusicRequest[] {
  const rows = db()
    .prepare(
      `SELECT r.id,r.artist,r.album,r.foreign_album_id foreignAlbumId,r.status requestStatus,t.status acquisitionStatus,t.next_retry_at nextRetry,r.updated_at updatedAt,
    (SELECT CASE WHEN count(DISTINCT f.album_key)=1 AND sum(f.status!='written')=0 THEN min(f.album_key) END FROM files f WHERE lower(f.artist_name)=lower(r.artist) AND lower(f.album_name)=lower(r.album)) albumKey
    FROM music_requests r LEFT JOIN acquisition_targets t ON t.lidarr_album_id=r.lidarr_album_id WHERE r.requester_user_id=? ORDER BY r.updated_at DESC`,
    )
    .all(userId) as Array<{
    id: number;
    artist: string;
    album: string;
    foreignAlbumId: string;
    requestStatus: string;
    acquisitionStatus: string | null;
    nextRetry: string | null;
    albumKey: string | null;
    updatedAt: string;
  }>;
  return rows.map((row) => {
    const raw = row.acquisitionStatus ?? row.requestStatus;
    const status = row.albumKey
      ? "added"
      : raw === "imported" || raw === "downloaded"
        ? "preparing"
        : raw === "downloading"
          ? "downloading"
          : raw === "failed" || raw === "error"
            ? "attention"
            : row.nextRetry || raw === "deferred" || raw === "waiting"
              ? "waiting"
              : "searching";
    const detail = {
      added: "Ready in your library.",
      preparing: "Preparing files and metadata for your library.",
      downloading: "The album is downloading in the background.",
      attention:
        "Acquisition needs attention. Library care has the service details.",
      waiting: "Waiting for a suitable source. Your request is saved.",
      searching: "Looking for a suitable source. You can leave this page.",
    }[status];
    return {
      id: row.id,
      artist: row.artist,
      album: row.album,
      foreignAlbumId: row.foreignAlbumId,
      status,
      detail,
      albumKey: row.albumKey,
      updatedAt: row.updatedAt,
    };
  });
}
