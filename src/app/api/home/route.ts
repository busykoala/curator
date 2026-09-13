import { currentUser, listCuratorUsers } from "@/features/auth/session";
import { homeData } from "@/features/home/query";
import { ensureAutomaticPlaylists } from "@/features/playlists/automatic";

export async function GET(request: Request) {
  try {
    const current = await currentUser();
    if (!current) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const users = listCuratorUsers();
    const requested = Number(
      new URL(request.url).searchParams.get("userId") || current.id,
    );
    const target = users.find((user) => user.id === requested);
    if (!target) {
      return Response.json(
        { error: "User has not signed into Curator" },
        { status: 404 },
      );
    }

    let automatic = { created: 0, removed: 0, total: 0, names: [] as string[] };
    let automaticWarning = "";
    try {
      automatic = await ensureAutomaticPlaylists(target.id);
    } catch (error) {
      automaticWarning =
        error instanceof Error
          ? error.message
          : "Automatic playlists could not be refreshed.";
    }

    return Response.json({
      user: target,
      users,
      automatic,
      automaticWarning,
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
