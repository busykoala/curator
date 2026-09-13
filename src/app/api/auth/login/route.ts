import { z } from "zod";
import { config } from "@/config";
import { authenticateNavidrome, provisionUser } from "@/features/auth/navidrome";
import { createSession, loginAllowed, recordLogin, sameOrigin, verifyLegacyPassword } from "@/features/auth/session";
export const runtime = "nodejs";
const input = z.object({ username: z.string().trim().min(1).max(120).optional(), password: z.string().min(1).max(500) });
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!loginAllowed(ip)) return Response.json({ error: "Login temporarily rate limited" }, { status: 429 });
  try {
    const value = input.parse(await request.json());
    let account;
    let migration = false;
    if (value.username) account = provisionUser(await authenticateNavidrome(value.username, value.password));
    else {
      if (!await verifyLegacyPassword(value.password)) throw new Error("Invalid legacy password");
      migration = true;
      try { account = provisionUser(await authenticateNavidrome(config.NAVIDROME_USERNAME, config.NAVIDROME_PASSWORD)); }
      catch { const username = config.NAVIDROME_USERNAME || "legacy"; account = provisionUser({ navidromeUserId: `legacy:${username.toLowerCase()}`, username, displayName: username, legacy: true }); }
    }
    recordLogin(ip, true);
    await createSession(account.id);
    return Response.json({ ok: true, user: account, migration });
  } catch (error) {
    recordLogin(ip, false);
    return Response.json({ error: error instanceof Error ? error.message : "Login failed" }, { status: 401 });
  }
}
