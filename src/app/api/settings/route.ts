import { authenticated, sameOrigin } from "@/features/auth/session";
import { publicRuntimeSettings, updateRuntimeSettings } from "@/features/settings/runtime";

export async function GET() {
  if (!await authenticated()) return new Response("Unauthorized", { status: 401 });
  return Response.json(publicRuntimeSettings());
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request) || !await authenticated()) return new Response("Forbidden", { status: 403 });
  try { return Response.json({ settings: updateRuntimeSettings(await request.json()) }); }
  catch (error) { return Response.json({ error: String(error) }, { status: 400 }); }
}
