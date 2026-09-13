import { z } from "zod";
import { authenticateNavidrome, provisionUser } from "@/features/auth/navidrome";
import { createSession, loginAllowed, recordLogin, sameOrigin } from "@/features/auth/session";
export const runtime = "nodejs";
const input = z.object({ username: z.string().trim().min(1).max(120), password: z.string().min(1).max(500) }).strict();
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!loginAllowed(ip)) return Response.json({ error: "Login temporarily rate limited" }, { status: 429 });
  try {
    const value = input.parse(await request.json());
    const account = provisionUser(await authenticateNavidrome(value.username, value.password));
    recordLogin(ip, true);
    await createSession(account.id);
    return Response.json({ ok: true, user: account });
  } catch (error) {
    recordLogin(ip, false);
    return Response.json({ error: error instanceof Error ? error.message : "Login failed" }, { status: 401 });
  }
}
