import { aiClient, aiConfigured, aiModel } from "@/features/ai/client";
import { recordAiUsage } from "@/features/ai/usage";
import { db } from "@/features/db/client";
import { norm } from "./candidate-score";
import { suggestChatPlaylist, type LibraryTrack } from "./chat-agent";
import { acquireChatLease, chatState, releaseChatLease, storeChatResult } from "./chat-state";
import { getPlaylist, updatePlaylist } from "./repository";
import { generatePlaylist } from "./generate";
import { z } from "zod";
export const chatRequestSchema=z.object({message:z.string().trim().min(1).max(3000),targetTracks:z.number().int().min(1).max(100),revision:z.number().int().nonnegative()});

export function chatLibrary(id:number):LibraryTrack[]{
  const feedback=db().prepare("SELECT file_id,artist,action FROM playlist_feedback WHERE (playlist_id=? OR playlist_id IS NULL) AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)").all(id) as Array<{file_id:number;artist:string;action:string}>;
  const excluded=new Set(feedback.filter(item=>["exclude","snooze"].includes(item.action)).map(item=>item.file_id));
  const artists=new Set(feedback.filter(item=>item.action==="artist_exclude").map(item=>norm(item.artist)));
  const rows=db().prepare("SELECT f.id,f.artist_name,f.album_name,f.tags_json,coalesce(p.profile_json,'{}') profile_json FROM files f LEFT JOIN track_profiles p ON p.file_id=f.id AND p.status='complete' WHERE f.status='written'").all() as Array<{id:number;artist_name:string;album_name:string;tags_json:string;profile_json:string}>;
  return rows.filter(row=>!excluded.has(row.id)&&!artists.has(norm(row.artist_name))).map(row=>{
    const tags=JSON.parse(row.tags_json), date=Array.isArray(tags.date)?tags.date[0]:tags.date??tags.year??0;
    return {fileId:row.id,title:String(Array.isArray(tags.title)?tags.title[0]:tags.title??"Untitled"),artist:row.artist_name,album:row.album_name,year:Number(String(date).slice(0,4))||0,profile:JSON.parse(row.profile_json),tags,score:0,reason:"",origin:"catalog"};
  });
}
export async function sendPlaylistMessage(id:number,raw:unknown){
  const request=chatRequestSchema.parse(raw),definition=getPlaylist(id);
  if(!definition||definition.category!=="chat")throw new Error("Chat playlist not found");
  if(!aiConfigured)throw new Error("The AI service is not configured.");
  const lease=acquireChatLease(id);
  try{
    const state=chatState(id);
    if(request.revision!==state.revision)throw new Error("This conversation has changed. Reopen the playlist and retry.");
    const result=await suggestChatPlaylist({client:aiClient,library:chatLibrary(id),messages:state.messages,message:request.message,targetTracks:request.targetTracks,current:state.result?.items??[],guidance:state.result?.guidance,priorRequirements:state.result?.detail.requirements,name:state.result?definition.name:undefined});
    recordAiUsage("playlist_chat",aiModel,{usage:result.detail.usage});
    const messages=[...state.messages,{role:"user" as const,content:request.message},{role:"assistant" as const,content:result.reply}];
    db().transaction(()=>{
      let name=result.name;
      for(let suffix=2;db().prepare("SELECT 1 FROM smart_playlists WHERE owner_user_id=? AND lower(name)=lower(?) AND id<>?").get(definition.ownerUserId,name,id);suffix++)name=result.name.slice(0,90)+` (${suffix})`;
      result.name=name;
      storeChatResult(id,lease,messages,result);
      updatePlaylist(id,{name:result.name,config:{targetTracks:request.targetTracks}});
    })();
    // Once published, corrections also update the listener's playlist immediately.
    let syncError="",synced=false;
    if(definition.navidromePlaylistId){
      try{await generatePlaylist(id,false,lease);synced=true}catch(error){syncError=error instanceof Error?error.message:String(error)}
    }
    return {definition:getPlaylist(id),...chatState(id),synced,syncError};
  }finally{releaseChatLease(id,lease)}
}
