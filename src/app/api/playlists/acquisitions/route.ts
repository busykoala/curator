import { currentUser } from "@/features/auth/session";
import { dashboardData } from "@/features/playlists/repository";
export async function GET(){const user=await currentUser();if(!user)return Response.json({error:"Unauthorized"},{status:401});return Response.json({items:dashboardData(user.id).acquisitions})}
