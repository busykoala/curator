import { authenticated,sameOrigin } from "@/features/auth/session";
import { deleteManagedPlaylist } from "@/features/integrations/navidrome";
import { getPlaylist,removePlaylist,updatePlaylist } from "@/features/playlists/repository";
const idOf=async(context:{params:Promise<{id:string}>})=>Number((await context.params).id);
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){if(!sameOrigin(request)||!await authenticated())return new Response("Forbidden",{status:403});try{return Response.json({playlist:updatePlaylist(await idOf(context),await request.json())})}catch(error){return Response.json({error:String(error)},{status:400})}}
export async function DELETE(request:Request,context:{params:Promise<{id:string}>}){if(!sameOrigin(request)||!await authenticated())return new Response("Forbidden",{status:403});try{const id=await idOf(context),playlist=getPlaylist(id);if(!playlist)throw new Error("Playlist not found");await deleteManagedPlaylist(playlist);removePlaylist(id);return Response.json({ok:true})}catch(error){return Response.json({error:String(error)},{status:400})}}
