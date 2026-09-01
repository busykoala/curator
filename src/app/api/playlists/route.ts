import { authenticated, sameOrigin } from "@/features/auth/session";
import { stateGet } from "@/features/db/client";
import { navidromeConfigured } from "@/features/integrations/navidrome";
import { ensureAutomaticPlaylists } from "@/features/playlists/automatic";
import {
  createPlaylist,
  dashboardData,
} from "@/features/playlists/repository";

export async function GET() {
  if (!(await authenticated())) {
    return new Response("Unauthorized", { status: 401 });
  }
  await ensureAutomaticPlaylists().catch(() => undefined);
  return Response.json({
    ...dashboardData(),
    connection: { configured: navidromeConfigured() },
    schedule: {
      lastRun: stateGet("playlist_run_date"),
      lastResearch: stateGet("playlist_research_date"),
      phase: stateGet("playlist_phase", "idle"),
      error: stateGet("playlist_error"),
    },
  });
}

export async function POST(request: Request) {
  if (!sameOrigin(request) || !(await authenticated())) {
    return new Response("Forbidden", { status: 403 });
  }
  try {
    return Response.json(
      { playlist: createPlaylist(await request.json()) },
      { status: 201 },
    );
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }
}
