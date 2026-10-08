import test from "node:test";
import assert from "node:assert/strict";
import { CuratorAiClient, type StructuredRequest } from "../ai/client";
import { libraryTools, searchLibrary, suggestChatPlaylist, type LibraryTrack, unrestrictedRequirements } from "./chat-agent";
const track=(fileId:number,title:string,artist:string,profile:Record<string,unknown>,year=1994):LibraryTrack=>({fileId,title,artist,album:"Album",year,profile,tags:{},score:0,reason:"",origin:"catalog"});
const library=[
  track(1,"Piano","Jazz Artist",{genre:["jazz"],vocalProfile:["instrumental"],instrumentation:["piano"],energy:"low",bpm:90}),
  track(2,"Song","Singer",{genre:["jazz"],vocalProfile:["clean_sung"],energy:"low",bpm:100}),
  track(3,"Unknown","Unknown",{genre:["jazz"],energy:"low"},0),
  track(4,"Loud","Band",{genre:["rock"],energy:"high",bpm:150}),
];
const filters={query:"",offset:0,genres:[],excludeGenres:[],instruments:[],moods:[],artists:[],excludeArtists:[],vocal:"any",energy:"any",minYear:0,maxYear:0,minBpm:0,maxBpm:0};
test("library search enforces vocal, range, genre, and artist exclusions",()=>{
  assert.deepEqual(searchLibrary(library,{...filters,genres:["jazz"],instruments:["piano"],excludeGenres:["electronic"],vocal:"instrumental",maxBpm:95}).map(item=>item.track.fileId),[1]);
  assert.deepEqual(searchLibrary(library,{...filters,genres:["jazz"],excludeArtists:["Singer"],minYear:1990,maxYear:1999}).map(item=>item.track.fileId),[1]);
  assert.deepEqual(searchLibrary(library,{...filters,genres:["jazz"],vocal:"vocals"}).map(item=>item.track.fileId),[2]);
});
test("library tools expose inspected IDs and reject malformed filters",()=>{
  const seen=new Set<number>(),trace:Parameters<typeof libraryTools>[2]=[],tools=libraryTools(library,seen,trace);
  assert.throws(()=>tools[1].execute({query:"bad"}));
  const result=tools[2].execute({fileIds:[1,999]}) as {tracks:unknown[]};
  assert.equal(result.tracks.length,1);assert.deepEqual([...seen],[1]);
});
function clientFor(data:unknown,inspect=[1]) {
  const client=new CuratorAiClient({apiKey:"test",baseURL:"http://localhost",model:"test"});
  client.structured=async <T>(request:StructuredRequest)=>{
    await request.tools?.find(tool=>tool.name==="set_requirements")?.execute(unrestrictedRequirements);
    await request.tools?.find(tool=>tool.name==="inspect_tracks")?.execute({fileIds:inspect});
    return {data:data as T,usage:{input_tokens:10,output_tokens:10,total_tokens:20}};
  };
  return client;
}
const output={name:"Quiet Jazz",reply:"A quiet mix.",guidance:"Quiet jazz",tracks:[{fileId:1,reason:"Instrumental piano"}]};
const input={library,messages:[],message:"Quiet jazz",targetTracks:1,current:[],web:false};
test("suggestions use actual metadata and preserve the current track on correction",async()=>{
  const result=await suggestChatPlaylist({...input,client:clientFor(output),current:[library[0]]});
  assert.equal(result.items[0].title,"Piano");assert.equal(result.items[0].retained,true);assert.equal(result.detail.pending,0);
});
test("suggestions reject invented, unseen, duplicate and excess songs",async()=>{
  for(const tracks of [[{fileId:999,reason:"Invented"}],[{fileId:4,reason:"Not inspected"}],[...output.tracks,...output.tracks]]){
    await assert.rejects(suggestChatPlaylist({...input,targetTracks:2,client:clientFor({...output,tracks})}));
  }
  await assert.rejects(suggestChatPlaylist({...input,client:clientFor({...output,tracks:[...output.tracks,{fileId:2,reason:"Extra"}]},[1,2])}),/more songs/);
});
test("shortages remain visible without padding the playlist",async()=>{
  const result=await suggestChatPlaylist({...input,targetTracks:8,client:clientFor(output)});
  assert.equal(result.items.length,1);assert.equal(result.detail.pending,7);
});
test("a malformed selection gets one bounded repair using only inspected candidates",async()=>{
  const client=clientFor(output);let requests=0;
  client.structured=async <T>(request:StructuredRequest)=>{
    requests++;
    await request.tools?.find(tool=>tool.name==="set_requirements")?.execute(unrestrictedRequirements);
    await request.tools?.find(tool=>tool.name==="inspect_tracks")?.execute({fileIds:[1]});
    return {data:(requests===1?{...output,tracks:[...output.tracks,...output.tracks]}:output) as T,usage:{input_tokens:10,output_tokens:10,total_tokens:20}};
  };
  const result=await suggestChatPlaylist({...input,client});
  assert.equal(requests,2);assert.equal(result.items.length,1);assert.equal(result.detail.usage.total_tokens,40);assert.ok(result.detail.repairDurationMs!==undefined);
});

test("non-Latin song titles remain distinct during recording validation",async()=>{
  const foreign=[track(11,"春","音楽家",{}),track(12,"秋","音楽家",{})];
  const result=await suggestChatPlaylist({...input,library:foreign,targetTracks:2,client:clientFor({...output,tracks:[{fileId:11,reason:"First"},{fileId:12,reason:"Second"}]},[11,12])});
  assert.equal(result.items.length,2);
});

test("a correction rejects retained songs without required instruments and repairs using compliant metadata only",async()=>{
  const guitar=track(5,"Bossa","Jazz Guitarist",{genre:["jazz"],vocalProfile:["instrumental"],instrumentation:["acoustic_guitar"]});
  const client=clientFor(output);let requests=0;
  client.structured=async <T>(request:StructuredRequest)=>{
    requests++;
    if(request.tools){
      await request.tools.find(tool=>tool.name==="set_requirements")?.execute({...unrestrictedRequirements,genres:["jazz"],instruments:["piano"],vocal:"instrumental"});
      assert.throws(()=>request.tools!.find(tool=>tool.name==="set_requirements")!.execute(unrestrictedRequirements),/already set/);
      await request.tools.find(tool=>tool.name==="inspect_tracks")?.execute({fileIds:[1,5]});
    }else{
      const repair=JSON.parse(request.input);
      assert.deepEqual(repair.candidates.map((item:{fileId:number})=>item.fileId),[1]);
      assert.deepEqual(repair.requirements.instruments,["piano"]);
    }
    return {data:(requests===1?{...output,tracks:[{fileId:5,reason:"Hallucinated piano"}]}:output) as T,usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  };
  const result=await suggestChatPlaylist({...input,library:[...library,guitar],current:[guitar],message:"Make it strictly instrumental piano jazz",client});
  assert.equal(requests,2);assert.equal(result.items[0].fileId,1);assert.equal(result.detail.requirements.vocal,"instrumental");
});

test("hard metadata requirements cannot be weakened by a repair",async()=>{
  const client=clientFor(output);
  client.structured=async <T>(request:StructuredRequest)=>{
    await request.tools?.find(tool=>tool.name==="set_requirements")?.execute({...unrestrictedRequirements,genres:["jazz"],instruments:["piano"],vocal:"instrumental"});
    await request.tools?.find(tool=>tool.name==="inspect_tracks")?.execute({fileIds:[1,2]});
    return {data:{...output,tracks:[{fileId:2,reason:"Does not meet the requirements"}]} as T,usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  };
  await assert.rejects(suggestChatPlaylist({...input,client}),/mandatory metadata requirements/);
});

test("long AI prose is bounded without discarding valid songs or spending a repair request",async()=>{
  const client=clientFor({...output,reply:"Explanation ".repeat(200),guidance:"Preferences ".repeat(200),tracks:[{fileId:1,reason:"Piano evidence ".repeat(30)}]});
  const result=await suggestChatPlaylist({...input,client});
  assert.equal(result.items[0].fileId,1);assert.ok(result.reply.length<=1600);assert.ok(result.reply.endsWith("…"));assert.ok(result.guidance.length<=2000);assert.ok(result.items[0].reason.length<=180);
  assert.equal(result.detail.usage.total_tokens,20);assert.equal(result.detail.repairDurationMs,undefined);
});

test("chat search surfaces only songs meeting active requirements and marks incompatible current songs",()=>{
  let allowed=new Set([1]);
  const tools=libraryTools(library,new Set(),[],8,()=>allowed);
  const overview=tools.find(tool=>tool.name==="library_overview")!.execute({}) as {tracks:number};
  assert.equal(overview.tracks,1);
  const search=tools.find(tool=>tool.name==="search_library")!.execute(filters) as {tracks:Array<{fileId:number}>};
  assert.deepEqual(search.tracks.map(item=>item.fileId),[1]);
  const inspect=tools.find(tool=>tool.name==="inspect_tracks")!.execute({fileIds:[1,2]}) as {tracks:Array<{fileId:number;meetsRequirements:boolean}>};
  assert.deepEqual(inspect.tracks.map(item=>[item.fileId,item.meetsRequirements]),[[1,true],[2,false]]);
  allowed=new Set([2]);
  const updated=tools.find(tool=>tool.name==="search_library")!.execute(filters) as {tracks:Array<{fileId:number}>};
  assert.deepEqual(updated.tracks.map(item=>item.fileId),[2]);
});
