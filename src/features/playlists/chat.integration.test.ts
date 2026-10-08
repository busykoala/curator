import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { StructuredRequest } from "../ai/client";

test("published chat corrections replace the exact playlist; failed sync retains the draft and prior published mix",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"curator-chat-sync-"));
  process.env.CURATOR_DB_PATH=join(directory,"test.sqlite");
  process.env.CURATOR_AI_API_KEY="test-only";
  const {db}=await import("../db/client");
  const {provisionUser}=await import("../auth/navidrome");
  const {createPlaylist}=await import("./repository");
  const {generatePlaylist}=await import("./generate");
  const {sendPlaylistMessage}=await import("./chat");
  const {aiClient}=await import("../ai/client");
  const originalFetch=globalThis.fetch,originalStructured=aiClient.structured;
  const database=db(),user=provisionUser({token:"test-listener-token",navidromeUserId:"listener",username:"listener",displayName:"Listener"});
  for(const id of [1,2]){
    database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES (?,?,'test','Artist',?,'flac',?,1,1,1,?,'{}','{}','written')").run(id,`/music/song-${id}.flac`,id===2?"Album [Bonus Track]":"Album",id,JSON.stringify({title:[id===2?"7":`Song ${id}`],trackNumber:id,discNumber:1,artist:id===2?"Collaborator feat. Artist":"Artist",album:"Album"}));
  }
  let aiRequests=0,published=false,failWrites=false,publishedIds:string[]=[];
  aiClient.structured=async <T>(request:StructuredRequest)=>{
    aiRequests++;await request.tools?.find(tool=>tool.name==="set_requirements")?.execute({genres:[],excludeGenres:[],instruments:[],artists:[],excludeArtists:[],vocal:"any",minYear:0,maxYear:0,minBpm:0,maxBpm:0});await request.tools?.find(tool=>tool.name==="inspect_tracks")?.execute({fileIds:[1,2]});
    const fileId=aiRequests===2?2:1;
    return {data:{name:"Test Mix",reply:"Updated",guidance:"Keep it calm",tracks:[{fileId,reason:"Matches your request"}]} as T,usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  };
  globalThis.fetch=async(url,init)=>{
    const parsed=new URL(String(url)),path=parsed.pathname;
    if(path.endsWith("/Items")&&parsed.searchParams.get("IncludeItemTypes")==="Audio"){
      const query=parsed.searchParams.get("SearchTerm");
      if(query==="7")return Response.json({Items:[]});
      return Response.json({Items:query==="Song 1"?[{Id:"song-1",Name:"Song 1",Album:"Album",Artists:["Artist"],Path:"/music/song-1.flac"}]:[{Id:"wrong-collaboration",Name:"7",Album:"Album",Artists:["Artist,Someone Else"],IndexNumber:2,ParentIndexNumber:1},{Id:"different-position",Name:"7",Album:"Album",Artists:["Artist","Collaborator"],IndexNumber:3,ParentIndexNumber:1},{Id:"song-2",Name:"7",Album:"Album",Artists:["Artist","Collaborator"],IndexNumber:2,ParentIndexNumber:1}]});
    }
    if(path.endsWith("/Items")&&parsed.searchParams.get("IncludeItemTypes")==="Playlist")return Response.json({Items:published?[{Id:"playlist-id",Name:"Test Mix"}]:[]});
    if(path.endsWith("/Playlists/playlist-id/Items"))return Response.json({Items:publishedIds.map(Id=>({Id}))});
    if(init?.method==="POST"&&(/\/Playlists$|\/Playlists\/playlist-id$/.test(path))){
      if(failWrites)return new Response("Temporary outage",{status:503});
      publishedIds=JSON.parse(String(init.body)).Ids;published=true;return Response.json({Id:"playlist-id"});
    }
    throw new Error(`Unexpected Navidrome request: ${path}`);
  };
  try{
    const playlist=createPlaylist({name:"Draft Mix",category:"chat",ownerUserId:user.id,config:{targetTracks:1}});
    const initial=await sendPlaylistMessage(playlist.id,{message:"Make a calm mix",targetTracks:1,revision:0});
    assert.equal(initial.synced,false);assert.equal(initial.revision,1);
    await generatePlaylist(playlist.id,false);
    assert.deepEqual(publishedIds,["song-1"]);
    const correction=await sendPlaylistMessage(playlist.id,{message:"Replace the song",targetTracks:1,revision:1});
    assert.equal(correction.synced,true);assert.deepEqual(publishedIds,["song-2"]);assert.equal(correction.definition?.navidromePlaylistId,"playlist-id");
    await assert.rejects(sendPlaylistMessage(playlist.id,{message:"Stale change",targetTracks:1,revision:1}),/conversation has changed/);
    assert.equal(aiRequests,2);
    failWrites=true;
    const unsynced=await sendPlaylistMessage(playlist.id,{message:"Bring the original back",targetTracks:1,revision:2});
    assert.equal(unsynced.synced,false);assert.ok(unsynced.syncError.includes("503"));assert.equal(unsynced.result?.items[0].fileId,1);assert.equal(unsynced.revision,3);assert.equal(unsynced.messages.length,6);
    assert.deepEqual(publishedIds,["song-2"]);
    const {enqueuePlaylistMessage,claimChatJob,checkpointChatJob,latestChatJob}=await import("./chat-jobs");
    const {runNextChatJob}=await import("./chat-job-runner");
    const {acquireChatLease,chatState}=await import("./chat-state");
    const {randomUUID}=await import("node:crypto");
    failWrites=false;
    enqueuePlaylistMessage(playlist.id,{requestId:randomUUID(),message:"Update in the background",targetTracks:1,revision:3});
    await assert.rejects(generatePlaylist(playlist.id,false),/already being updated/);
    await runNextChatJob();
    assert.equal(latestChatJob(playlist.id)?.status,"completed");assert.equal(latestChatJob(playlist.id)?.synced,true);
    assert.deepEqual(publishedIds,["song-1"]);assert.equal(chatState(playlist.id).revision,4);
    const pending={requestId:randomUUID(),message:"Recover a published correction",targetTracks:1,revision:4};
    enqueuePlaylistMessage(playlist.id,pending);
    const interrupted=claimChatJob()!;acquireChatLease(playlist.id,interrupted.id,interrupted.lease);
    failWrites=true;
    await sendPlaylistMessage(playlist.id,pending,{lease:interrupted.lease,stored:()=>checkpointChatJob(interrupted.id,interrupted.lease,chatState(playlist.id).revision)});
    const beforeRecovery=aiRequests;
    database.prepare("UPDATE playlist_chat_jobs SET lease_until=1 WHERE id=?").run(interrupted.id);
    failWrites=false;
    await runNextChatJob();
    assert.equal(aiRequests,beforeRecovery);assert.equal(chatState(playlist.id).revision,5);
    assert.equal(latestChatJob(playlist.id)?.synced,true);assert.equal(latestChatJob(playlist.id)?.status,"completed");
    assert.deepEqual(publishedIds,["song-1"]);assert.equal(chatState(playlist.id).messages.length,10);
  }finally{
    globalThis.fetch=originalFetch;aiClient.structured=originalStructured;database.close();delete (globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true});
  }
});
