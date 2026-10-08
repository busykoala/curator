import { authenticated, sameOrigin } from "@/features/auth/session";
import { getPlaylist } from "@/features/playlists/repository";
import { chatState } from "@/features/playlists/chat-state";
import { sendPlaylistMessage } from "@/features/playlists/chat";
export const maxDuration=300;
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,{params}:Context){
  if(!await authenticated())return Response.json({error:"Unauthorized"},{status:401});
  const id=Number((await params).id),definition=getPlaylist(id);
  if(!definition||definition.category!=="chat")return Response.json({error:"Chat playlist not found"},{status:404});
  return Response.json({definition,...chatState(id)});
}
export async function POST(request:Request,{params}:Context){
  if(!sameOrigin(request)||!await authenticated())return Response.json({error:"Forbidden"},{status:403});
  try{return Response.json(await sendPlaylistMessage(Number((await params).id),await request.json()))}
  catch(error){const message=error instanceof Error?error.message:String(error);return Response.json({error:message},{status:/already being updated|conversation has changed/.test(message)?409:400})}
}
