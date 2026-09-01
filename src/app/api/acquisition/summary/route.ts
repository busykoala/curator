import { authenticated } from "@/features/auth/session";
import { acquisitionSummary } from "@/features/acquisition/summary";
export async function GET(){if(!await authenticated())return new Response("Unauthorized",{status:401});return Response.json(acquisitionSummary())}
