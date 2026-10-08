import { authenticated } from "@/features/auth/session";
import { db } from "@/features/db/client";
import { searchMusic } from "@/features/integrations/music";
export async function GET(request: Request) {
  if (!(await authenticated()))
    return new Response("Unauthorized", { status: 401 });
  try {
    const result = (await searchMusic(
      new URL(request.url).searchParams.get("q") ?? "",
    )) as { artists: unknown[]; albums: Array<Record<string, unknown>> };
    const find = db().prepare(
      "SELECT CASE WHEN count(DISTINCT album_key)=1 AND sum(status!='written')=0 THEN min(album_key) END albumKey FROM files WHERE lower(artist_name)=lower(?) AND lower(album_name)=lower(?)",
    );
    return Response.json({
      ...result,
      albums: result.albums.map((album) => ({
        ...album,
        libraryAlbumKey: (
          find.get(
            String((album.artist as { artistName?: string })?.artistName ?? ""),
            String(album.title ?? ""),
          ) as { albumKey: string | null }
        ).albumKey,
      })),
    });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 502 });
  }
}
