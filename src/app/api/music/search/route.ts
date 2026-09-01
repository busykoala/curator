import { authenticated } from "@/features/auth/session";
import { searchMusic } from "@/features/integrations/music";
export async function GET(request:Request){if(!await authenticated())return new Response("Unauthorized",{status:401});try{return Response.json(await searchMusic(new URL(request.url).searchParams.get("q")??""))}catch(error){return Response.json({error:String(error)},{status:502})}}
