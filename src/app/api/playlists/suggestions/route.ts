import { authenticated } from "@/features/auth/session";
import { playlistSuggestions } from "@/features/playlists/clusters";
export async function GET(){if(!await authenticated())return new Response("Unauthorized",{status:401});try{return Response.json(await playlistSuggestions())}catch(error){return Response.json({error:String(error)},{status:502})}}
