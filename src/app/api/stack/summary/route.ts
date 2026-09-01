import { authenticated } from "@/features/auth/session";
import { stackSummary } from "@/features/integrations/stack";
export async function GET(){if(!await authenticated())return new Response("Unauthorized",{status:401});return Response.json(await stackSummary())}
