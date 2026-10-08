import { currentUser, sameOrigin } from "@/features/auth/session";
import { db } from "@/features/db/client";
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(
    db()
      .prepare("SELECT appearance FROM listener_preferences WHERE user_id=?")
      .get(user.id) ?? { appearance: "system" },
  );
}
export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user || !sameOrigin(request))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) ?? {};
  if (!["system", "light", "dark"].includes(body.appearance))
    return Response.json(
      { error: "Choose a valid appearance" },
      { status: 400 },
    );
  db()
    .prepare(
      "INSERT INTO listener_preferences(user_id,appearance) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET appearance=excluded.appearance",
    )
    .run(user.id, body.appearance);
  return Response.json({ appearance: body.appearance });
}
