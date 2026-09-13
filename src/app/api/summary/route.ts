import { authenticated } from "@/features/auth/session";
import { snapshot } from "@/features/dashboard/query";
export async function GET(){if(!await authenticated())return Response.json({error:"Unauthorized"},{status:401});try{return Response.json(snapshot())}catch(error){console.error("summary_request_failed",{error:error instanceof Error?error.message:String(error)});return Response.json({error:"Curator summary is temporarily unavailable."},{status:500})}}
