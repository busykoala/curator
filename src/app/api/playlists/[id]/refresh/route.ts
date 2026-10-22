import {z} from 'zod';
import {playlistAccess,playlistError} from '@/features/playlists/access';
import {requestPlaylistRefresh} from '@/features/playlists/refresh-jobs';
import {getPlaylist} from '@/features/playlists/repository';
const schema=z.object({requestId:z.string().uuid(),retry:z.boolean().optional()});
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  const id=Number((await params).id),access=await playlistAccess(request,id,true);if(access instanceof Response)return access;
  try{
    const input=schema.parse(await request.json()),jobId=requestPlaylistRefresh(id,access.user.id,input.requestId,input.retry);
    return Response.json({jobId,definition:getPlaylist(id)},{status:202,headers:{'Cache-Control':'no-store'}});
  }catch(error){return playlistError(error)}
}
