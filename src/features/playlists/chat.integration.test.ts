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
    database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES (?,?,'test','Artist',?,'flac',?,1,1,1,?,'{}','{}','written')").run(id,`/music/song-${id}.flac`,id===2?"Album [Bonus Track]":"Album",id,JSON.stringify({title:[`Song ${id}`],artist:id===2?"Collaborator feat. Artist":"Artist",album:"Album"}));
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
      const id=parsed.searchParams.get("SearchTerm")==="Song 2"?2:1;
      return Response.json({Items:id===2?[{Id:"wrong-collaboration",Name:"Song 2",Album:"Album",Artists:["Artist,Someone Else"]},{Id:"song-2",Name:"Song 2",Album:"Album",Artists:["Artist","Collaborator"]}]:[{Id:"song-1",Name:"Song 1",Album:"Album",Artists:["Artist"],Path:"/music/song-1.flac"}]});
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
  }finally{
    globalThis.fetch=originalFetch;aiClient.structured=originalStructured;database.close();delete (globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true});
  }
});
