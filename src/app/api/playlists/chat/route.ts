import { currentUser, sameOrigin } from "@/features/auth/session";
import { ownerInputMatches, playlistError } from "@/features/playlists/access";
import { createPlaylistChat } from "@/features/playlists/chat-jobs";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const user = await currentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    if (!ownerInputMatches(body, user.id)) return Response.json({ error: "Forbidden" }, { status: 403 });
    return Response.json(createPlaylistChat(user.id, body), { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return playlistError(error); }
}
