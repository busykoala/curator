import {playlistAccess,playlistError} from '@/features/playlists/access';
import {dismissDiscoveryRecommendation} from '@/features/playlists/discovery-repository';
export async function DELETE(request:Request,{params}:{params:Promise<{id:string;recommendationId:string}>}){
  const values=await params,id=Number(values.id),access=await playlistAccess(request,id,true);if(access instanceof Response)return access;
  try{
    if(!dismissDiscoveryRecommendation(Number(values.recommendationId),id,access.user.id))return Response.json({error:'Recommendation not found'},{status:404});
    return Response.json({ok:true});
  }catch(error){return playlistError(error)}
}
