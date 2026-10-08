import { config } from "@/config";
import { currentUser } from "@/features/auth/session";
export async function GET() { const user = await currentUser(); if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 }); return Response.json({ user, users: [user], navidromePublicUrl: config.NAVIDROME_PUBLIC_URL }); }
