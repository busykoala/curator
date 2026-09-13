import { config } from "@/config";
import { currentUser, listCuratorUsers } from "@/features/auth/session";
export async function GET() { const user = await currentUser(); if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 }); return Response.json({ user, users: listCuratorUsers(), navidromePublicUrl: config.NAVIDROME_PUBLIC_URL }); }
