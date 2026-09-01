import { z } from "zod";
import { authenticated,sameOrigin } from "@/features/auth/session";
import { acquisitionAction } from "@/features/acquisition/summary";
const body=z.object({action:z.enum(["run","pause","resume","retry-target"]),targetId:z.number().int().positive().optional()});
export async function POST(request:Request){if(!sameOrigin(request)||!await authenticated())return new Response("Forbidden",{status:403});try{const value=body.parse(await request.json());return Response.json(acquisitionAction(value.action,value.targetId))}catch(error){return Response.json({error:String(error)},{status:400})}}
