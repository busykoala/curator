import { authenticated,sameOrigin } from "@/features/auth/session";
import { addMusic } from "@/features/integrations/music";
export async function POST(request:Request){if(!sameOrigin(request)||!await authenticated())return new Response("Forbidden",{status:403});try{const body=await request.json() as{foreignArtistId?:string;albumForeignIds?:string[]};if(!body.foreignArtistId)return new Response("Artist is required",{status:400});return Response.json(await addMusic(body.foreignArtistId,body.albumForeignIds??[]))}catch(error){return Response.json({error:String(error)},{status:502})}}
