import { currentUser, sameOrigin } from "@/features/auth/session";
import { getPlaylist } from "./repository";

export function ownedPlaylist(id: number, userId: number) {
  const playlist = getPlaylist(id);
  return playlist?.ownerUserId === userId ? playlist : undefined;
}
export function requestedUserMatches(request: Request, userId: number) {
  const requested = new URL(request.url).searchParams.get("userId");
  return requested === null || Number(requested) === userId;
}
export function ownerInputMatches(
  input: Record<string, unknown>,
  userId: number,
) {
  return input.ownerUserId === undefined || input.ownerUserId === userId;
}
export async function playlistAccess(
  request: Request,
  id: number,
  mutation = false,
) {
  if (mutation && !sameOrigin(request))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const user = await currentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const playlist = ownedPlaylist(id, user.id);
  if (!playlist)
    return Response.json({ error: "Playlist not found" }, { status: 404 });
  return { user, playlist };
}
export function playlistError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const message =
    /smart_playlists_owner_name|UNIQUE constraint failed:.*smart_playlists/.test(
      raw,
    )
      ? "You already have a playlist with that name. Choose another name."
      : raw;
  return Response.json(
    { error: message },
    {
      status:
        /already being updated|conversation has changed|request ID has already/.test(
          message,
        )
          ? 409
          : 400,
    },
  );
}
