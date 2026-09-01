import { z } from "zod";
import { authenticated,sameOrigin } from "@/features/auth/session";
import { feedback } from "@/features/playlists/repository";
const schema=z.object({fileId:z.number().int().positive(),artist:z.string().max(200),action:z.enum(["pin","exclude","snooze","artist_exclude"])});
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){if(!sameOrigin(request)||!await authenticated())return new Response("Forbidden",{status:403});try{const value=schema.parse(await request.json());feedback(Number((await params).id),value.fileId,value.artist,value.action);return Response.json({ok:true})}catch(error){return Response.json({error:String(error)},{status:400})}}
