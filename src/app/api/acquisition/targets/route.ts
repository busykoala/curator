import { authenticated } from "@/features/auth/session";
import { acquisitionTargets } from "@/features/acquisition/summary";
export async function GET(request:Request){if(!await authenticated())return new Response("Unauthorized",{status:401});const limit=Math.min(500,Math.max(1,Number(new URL(request.url).searchParams.get("limit")??100)));return Response.json({targets:acquisitionTargets(limit)})}
