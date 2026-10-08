import { currentUser, sameOrigin } from "@/features/auth/session";
import { ownerInputMatches, requestedUserMatches } from "@/features/playlists/access";
import { stateGet } from "@/features/db/client";
import { navidromeConfigured } from "@/features/integrations/navidrome";
import { ensureAutomaticPlaylists } from "@/features/playlists/automatic";
import {
  createPlaylist,
  dashboardData,
} from "@/features/playlists/repository";

export async function GET(request: Request) {
  try {
    const current = await currentUser();
    if (!current) return Response.json({ error: "Unauthorized" }, { status: 401 });

    if (!requestedUserMatches(request, current.id)) return Response.json({ error: "Forbidden" }, { status: 403 });
    const target = current, users = [current];

    let automaticWarning = "";
    try {
      await ensureAutomaticPlaylists(target.id);
    } catch (error) {
      automaticWarning =
        error instanceof Error
          ? error.message
          : "Automatic playlists could not be refreshed.";
    }

    return Response.json({
      ...dashboardData(target.id),
      selectedUser: target,
      users,
      automaticWarning,
      connection: {
        configured: target.tokenStatus === "active",
        serviceConfigured: navidromeConfigured(),
      },
      schedule: {
        lastRun: stateGet("playlist_run_date"),
        lastResearch: stateGet("playlist_research_date"),
        phase: stateGet("playlist_phase", "idle"),
        error: stateGet("playlist_error"),
      },
    });
  } catch (error) {
    console.error("playlist_dashboard_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { error: "Playlists could not be loaded. Please retry." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!sameOrigin(request) || !user) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!ownerInputMatches(body, user.id)) return Response.json({ error: "Forbidden" }, { status: 403 });
    return Response.json(
      { playlist: createPlaylist({ ...body, ownerUserId: user.id }) },
      { status: 201 },
    );
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }
}
