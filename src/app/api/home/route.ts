import { currentUser,listCuratorUsers } from "@/features/auth/session";
import { homeData } from "@/features/home/query";
import { ensureAutomaticPlaylists } from "@/features/playlists/automatic";
export async function GET(request:Request){const current=await currentUser();if(!current)return Response.json({error:"Unauthorized"},{status:401});const requested=Number(new URL(request.url).searchParams.get("userId")||current.id),target=listCuratorUsers().find(user=>user.id===requested);if(!target)return Response.json({error:"User has not signed into Curator"},{status:404});await ensureAutomaticPlaylists(target.id);return Response.json({user:target,users:listCuratorUsers(),...homeData(target.id)})}
