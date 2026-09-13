import { currentUser, listCuratorUsers, sameOrigin } from "@/features/auth/session";
import { stateGet } from "@/features/db/client";
import { navidromeConfigured } from "@/features/integrations/navidrome";
import { ensureAutomaticPlaylists } from "@/features/playlists/automatic";
import {
  createPlaylist,
  dashboardData,
} from "@/features/playlists/repository";

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  await ensureAutomaticPlaylists(user.id).catch(() => undefined);
  return Response.json({
    ...dashboardData(),
    connection: { configured: listCuratorUsers().some(item=>item.tokenStatus==="active"), serviceConfigured: navidromeConfigured() },
    schedule: {
      lastRun: stateGet("playlist_run_date"),
      lastResearch: stateGet("playlist_research_date"),
      phase: stateGet("playlist_phase", "idle"),
      error: stateGet("playlist_error"),
    },
  });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!sameOrigin(request) || !user) {
    return new Response("Forbidden", { status: 403 });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    return Response.json(
      { playlist: createPlaylist({ ...body, ownerUserId: Number(body.ownerUserId) || user.id }) },
      { status: 201 },
    );
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }
}
