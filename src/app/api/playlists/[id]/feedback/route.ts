import { z } from "zod";
import { db } from "@/features/db/client";
import { playlistAccess, playlistError } from "@/features/playlists/access";
import { assertChatIdle } from "@/features/playlists/chat-jobs";
import { feedback, removeFeedback } from "@/features/playlists/repository";
const schema = z.object({ fileId: z.number().int().positive(), artist: z.string().max(200), action: z.enum(["pin", "exclude", "snooze", "artist_exclude"]) });
type Context = { params: Promise<{ id: string }> };
async function mutate(request: Request, { params }: Context, remove: boolean) {
  const id = Number((await params).id), access = await playlistAccess(request, id, true);
  if (access instanceof Response) return access;
  try {
    const value = schema.parse(await request.json());
    db().transaction(() => { assertChatIdle(id); if (remove) removeFeedback(id, value.fileId, value.action); else feedback(id, value.fileId, value.artist, value.action); })();
    return Response.json({ ok: true });
  } catch (error) { return playlistError(error); }
}
export const POST = (request: Request, context: Context) => mutate(request, context, false);
export const DELETE = (request: Request, context: Context) => mutate(request, context, true);
