import { currentUser, sameOrigin } from "@/features/auth/session";
import { addMusic } from "@/features/integrations/music";
import { db } from "@/features/db/client";
export async function POST(request: Request) {
  const user = await currentUser();
  if (!sameOrigin(request) || !user)
    return new Response("Forbidden", { status: 403 });
  try {
    const body = (await request.json()) as {
      foreignArtistId?: string;
      albumForeignIds?: string[];
    };
    if (!body.foreignArtistId)
      return new Response("Artist is required", { status: 400 });
    const prior =
      body.albumForeignIds?.length === 1
        ? (db()
            .prepare(
              "SELECT id FROM music_requests WHERE requester_user_id=? AND foreign_album_id=?",
            )
            .get(user.id, body.albumForeignIds[0]) as
            | { id: number }
            | undefined)
        : undefined;
    if (prior)
      return Response.json({ requestId: prior.id, alreadyRequested: true });
    const result = await addMusic(
      body.foreignArtistId,
      body.albumForeignIds ?? [],
    );
    const insert = db().prepare(
      "INSERT INTO music_requests(requester_user_id,foreign_artist_id,foreign_album_id,lidarr_artist_id,lidarr_album_id,artist,album,status,detail_json) VALUES (?,?,?,?,?,?,?,'queued',?) ON CONFLICT(requester_user_id,foreign_album_id) DO UPDATE SET lidarr_artist_id=excluded.lidarr_artist_id,lidarr_album_id=excluded.lidarr_album_id,artist=excluded.artist,album=excluded.album,status='queued',detail_json=excluded.detail_json,updated_at=CURRENT_TIMESTAMP",
    );
    for (const album of result.albums)
      insert.run(
        user.id,
        body.foreignArtistId,
        album.foreignAlbumId,
        result.artistId,
        album.id,
        album.artist,
        album.title,
        JSON.stringify({ controllerQueued: result.controllerQueued }),
      );
    const requestRow = db()
      .prepare(
        "SELECT id FROM music_requests WHERE requester_user_id=? AND foreign_album_id=?",
      )
      .get(user.id, body.albumForeignIds?.[0]) as { id: number } | undefined;
    return Response.json({ ...result, requestId: requestRow?.id });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 502 });
  }
}
