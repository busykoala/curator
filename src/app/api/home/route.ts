import { requestedUserMatches } from "@/features/playlists/access";
import { currentUser } from "@/features/auth/session";
import { homeData } from "@/features/home/query";

export async function GET(request: Request) {
  try {
    const current = await currentUser();
    if (!current) return Response.json({ error: "Unauthorized" }, { status: 401 });

    if (!requestedUserMatches(request, current.id)) return Response.json({ error: "Forbidden" }, { status: 403 });
    const target = current, users = [current];

    return Response.json({
      user: target,
      users,
      ...homeData(target.id),
    });
  } catch (error) {
    console.error("home_request_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { error: "Home could not be prepared. Please retry." },
      { status: 500 },
    );
  }
}
