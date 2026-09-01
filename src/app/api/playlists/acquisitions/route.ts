import { authenticated } from "@/features/auth/session";
import { db } from "@/features/db/client";
export async function GET(){if(!await authenticated())return new Response("Unauthorized",{status:401});return Response.json({items:db().prepare("SELECT * FROM discovery_candidates ORDER BY updated_at DESC LIMIT 200").all()})}
