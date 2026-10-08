import { db } from "@/features/db/client";
import { deleteManagedPlaylist } from "@/features/integrations/navidrome";
import {
  removePlaylist,
  updatePlaylist,
  playlistSnapshot,
} from "@/features/playlists/repository";
import {
  ownerInputMatches,
  playlistAccess,
  playlistError,
} from "@/features/playlists/access";
import { assertChatIdle } from "@/features/playlists/chat-jobs";
import {
  acquireChatLease,
  releaseChatLease,
} from "@/features/playlists/chat-state";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, { params }: Context) {
  const id = Number((await params).id),
    access = await playlistAccess(request, id, true);
  if (access instanceof Response) return access;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!ownerInputMatches(body, access.user.id))
      return Response.json(
        { error: "Playlist ownership cannot be changed" },
        { status: 403 },
      );
    const playlist = db().transaction(() => {
      assertChatIdle(id);
      return updatePlaylist(id, body);
    })();
    return Response.json({ playlist });
  } catch (error) {
    return playlistError(error);
  }
}
export async function DELETE(request: Request, { params }: Context) {
  const id = Number((await params).id),
    access = await playlistAccess(request, id, true);
  if (access instanceof Response) return access;
  let lease: string | undefined;
  try {
    if (access.playlist.category === "chat") lease = acquireChatLease(id);
    await deleteManagedPlaylist(access.playlist);
    removePlaylist(id);
    return Response.json({ ok: true });
  } catch (error) {
    return playlistError(error);
  } finally {
    if (lease) releaseChatLease(id, lease);
  }
}

export async function GET(request: Request, { params }: Context) {
  const id = Number((await params).id),
    access = await playlistAccess(request, id);
  if (access instanceof Response) return access;
  return Response.json(playlistSnapshot(id), {
    headers: { "Cache-Control": "no-store" },
  });
}
