import { randomUUID } from "node:crypto";
import { db } from "@/features/db/client";
import type { PlaylistCandidate } from "./types";
import type { ChatMessage, suggestChatPlaylist } from "./chat-agent";
type Suggestion=Awaited<ReturnType<typeof suggestChatPlaylist>>;
export type ChatResult=Omit<Suggestion,"detail">&{detail:Omit<Suggestion["detail"],"requirements">&{requirements?:Suggestion["detail"]["requirements"]}};
type Row={revision:number;conversation_json:string;result_json:string};
export function chatState(id:number){
  const row=db().prepare("SELECT revision,conversation_json,result_json FROM playlist_chat_state WHERE playlist_id=?").get(id) as Row|undefined;
  return {revision:row?.revision??0,messages:JSON.parse(row?.conversation_json??"[]") as ChatMessage[],result:row&&row.revision?JSON.parse(row.result_json) as ChatResult:null};
}
export function acquireChatLease(id:number,jobId?:string,token?:string){
  return db().transaction(()=>{
    const pending=db().prepare("SELECT id FROM playlist_chat_jobs WHERE playlist_id=? AND status IN ('queued','running')").get(id) as {id:string}|undefined;
    if(pending&&pending.id!==jobId)throw new Error("This playlist is already being updated. Please wait for that update to finish.");
    db().prepare("INSERT OR IGNORE INTO playlist_chat_state(playlist_id) VALUES (?)").run(id);
    const lease=token??randomUUID(),now=Date.now();
    const updated=db().prepare("UPDATE playlist_chat_state SET lease=?,lease_until=? WHERE playlist_id=? AND lease_until<?").run(lease,now+600_000,id,now);
    if(!updated.changes)throw new Error("This playlist is already being updated. Please wait for that update to finish.");
    return lease;
  })();
}
export function releaseChatLease(id:number,lease:string){db().prepare("UPDATE playlist_chat_state SET lease=NULL,lease_until=0 WHERE playlist_id=? AND lease=?").run(id,lease)}
export function storeChatResult(id:number,lease:string,messages:ChatMessage[],result:ChatResult){
  const updated=db().prepare("UPDATE playlist_chat_state SET revision=revision+1,conversation_json=?,result_json=?,updated_at=CURRENT_TIMESTAMP WHERE playlist_id=? AND lease=? AND lease_until>?").run(JSON.stringify(messages),JSON.stringify(result),id,lease,Date.now());
  if(!updated.changes)throw new Error("Playlist changed while the AI was working. Please retry.");
}
export function currentChatItems(id:number):PlaylistCandidate[]{
  const result=chatState(id).result;
  if(!result)throw new Error("Describe your playlist in chat first.");
  return result.items;
}
