import { currentUser } from "@/features/auth/session";
import { playlistSuggestions } from "@/features/playlists/clusters";
export async function GET(){const user=await currentUser();if(!user)return new Response("Unauthorized",{status:401});try{return Response.json(await playlistSuggestions(user.id))}catch(error){return Response.json({error:String(error)},{status:502})}}
