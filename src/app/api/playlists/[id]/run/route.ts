import { authenticated,sameOrigin } from "@/features/auth/session";
import { generatePlaylist } from "@/features/playlists/generate";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){if(!sameOrigin(request)||!await authenticated())return new Response("Forbidden",{status:403});try{const body=await request.json().catch(()=>({}));return Response.json(await generatePlaylist(Number((await params).id),body.preview!==false))}catch(error){return Response.json({error:String(error)},{status:400})}}
