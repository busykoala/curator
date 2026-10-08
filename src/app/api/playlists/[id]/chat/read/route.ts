import { playlistAccess } from "@/features/playlists/access";
import { db } from "@/features/db/client";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id),
    access = await playlistAccess(request, id, true);
  if (access instanceof Response) return access;
  if (access.playlist.category !== "chat")
    return Response.json({ error: "Chat playlist not found" }, { status: 404 });
  const { revision } = (await request.json().catch(() => ({}))) ?? {};
  if (!Number.isSafeInteger(revision) || revision < 0)
    return Response.json({ error: "Invalid revision" }, { status: 400 });
  db()
    .prepare(
      "UPDATE playlist_chat_state SET read_revision=max(read_revision,min(revision,?)) WHERE playlist_id=?",
    )
    .run(revision, id);
  return Response.json({ ok: true });
}
