import { authenticated } from "@/features/auth/session";
import { playlistOptions } from "@/features/playlists/options";

export async function GET() {
  if (!(await authenticated())) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json(playlistOptions());
}
