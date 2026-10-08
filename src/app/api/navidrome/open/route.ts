import { redirect } from "next/navigation";
import { config } from "@/config";
import { currentUser } from "@/features/auth/session";
import { ownedPlaylist } from "@/features/playlists/access";
import {
  navidromePlaylists,
  nativeAlbumForFile,
} from "@/features/integrations/navidrome";
import { nativeIdFromJellyfin } from "@/features/integrations/navidrome-links";
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const params = new URL(request.url).searchParams,
    playlistId = params.get("playlistId"),
    fileId = params.get("fileId");
  let target = "/album";
  if (playlistId) {
    const playlist = ownedPlaylist(Number(playlistId), user.id);
    if (!playlist?.navidromePlaylistId)
      return Response.json({ error: "Playlist not found" }, { status: 404 });
    const wire = playlist.navidromePlaylistId,
      converted = nativeIdFromJellyfin(wire);
    const native = await navidromePlaylists().catch(() => null),
      match = native?.find((p) => p.key === wire || p.key === converted);
    if (!match) redirect("/playlists/" + playlist.id + "?native=unavailable");
    target = "/playlist/" + encodeURIComponent(match.key) + "/show";
  } else if (fileId) {
    const id = Number(fileId);
    if (!Number.isSafeInteger(id) || id < 1)
      return Response.json({ error: "Invalid song" }, { status: 400 });
    const album = await nativeAlbumForFile(id).catch(() => null);
    if (!album) redirect("/library/songs/" + id + "?native=unavailable");
    target = "/album/" + encodeURIComponent(album) + "/show";
  }
  redirect(`${config.NAVIDROME_PUBLIC_URL.replace(/\/$/, "")}/app/#${target}`);
}
