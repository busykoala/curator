import { playlistAccess, playlistError } from "@/features/playlists/access";
import { enqueuePlaylistMessage, playlistChatView } from "@/features/playlists/chat-jobs";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  const id = Number((await params).id), access = await playlistAccess(request, id);
  if (access instanceof Response) return access;
  if (access.playlist.category !== "chat") return Response.json({ error: "Chat playlist not found" }, { status: 404 });
  return Response.json(playlistChatView(id), { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request, { params }: Context) {
  const id = Number((await params).id), access = await playlistAccess(request, id, true);
  if (access instanceof Response) return access;
  try { return Response.json(enqueuePlaylistMessage(id, await request.json()), { status: 202, headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return playlistError(error); }
}
