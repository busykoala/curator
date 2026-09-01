import { authenticated } from "@/features/auth/session";
import { snapshot } from "@/features/dashboard/query";
export async function GET(){if(!await authenticated())return new Response("Unauthorized",{status:401});return Response.json(snapshot())}
