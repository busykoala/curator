import { playlistAccess, playlistError } from "@/features/playlists/access";
import { generatePlaylist } from "@/features/playlists/generate";
import { markChatSynced } from "@/features/playlists/chat-jobs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id), access = await playlistAccess(request, id, true);
  if (access instanceof Response) return access;
  try {
    const body = await request.json().catch(() => ({})), result = await generatePlaylist(id, body.preview !== false);
    if (access.playlist.category === "chat" && body.preview === false) markChatSynced(id);
    return Response.json(result);
  } catch (error) { return playlistError(error); }
}
