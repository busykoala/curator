import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { CuratorAiClient } from "../src/features/ai/client";
import { suggestChatPlaylist, type LibraryTrack, type ChatMessage } from "../src/features/playlists/chat-agent";
import type { PlaylistCandidate } from "../src/features/playlists/types";

// Credentials and a read-only metadata export are supplied privately, never embedded in reports.
async function main(){
const directory=process.env.PLAYLIST_EVAL_INPUT??"/tmp/curator-playlist-eval";
let credentials:{apiKey:string;baseURL:string;model:string},metadata:string;
if(process.env.PLAYLIST_EVAL_KUBECONFIG){
  const kubectl=(args:string[])=>execFileSync("kubectl",["--kubeconfig",process.env.PLAYLIST_EVAL_KUBECONFIG!,"-n","music-server",...args],{encoding:"utf8",maxBuffer:64*1024*1024});
  const secret=JSON.parse(kubectl(["get","secret","music-server-secrets","-o","json"]));
  if(!secret.data?.CURATOR_AI_API_KEY)throw new Error("Cluster secret contains no AI credential.");
  credentials={apiKey:Buffer.from(secret.data.CURATOR_AI_API_KEY,"base64").toString("utf8"),baseURL:process.env.PLAYLIST_EVAL_AI_URL??"https://inference.blizzard.busykoala.io/v1",model:process.env.CURATOR_AI_MODEL??"curator"};
  const script="const db=require('better-sqlite3')('/app/data/curator.sqlite',{readonly:true});console.log(JSON.stringify(db.prepare(\"SELECT f.id fileId,f.artist_name artist,f.album_name album,f.tags_json tagsJson,coalesce(p.profile_json,'{}') profileJson FROM files f LEFT JOIN track_profiles p ON p.file_id=f.id AND p.status='complete' WHERE f.status='written' ORDER BY f.id\").all()))";
  metadata=kubectl(["exec","deployment/music-curator","-c","music-curator","--","node","-e",script]);
}else{
  credentials=JSON.parse(await readFile(`${directory}/credentials.json`,"utf8"));
  metadata=await readFile(`${directory}/library.json`,"utf8");
}
const client=new CuratorAiClient(credentials);
const rows=JSON.parse(metadata) as Array<{fileId:number;artist:string;album:string;tagsJson:string;profileJson:string}>;
const library:LibraryTrack[]=rows.map(row=>{
  const tags=JSON.parse(row.tagsJson), title=Array.isArray(tags.title)?tags.title[0]:tags.title;
  return {fileId:row.fileId,title:String(title??"Untitled"),artist:row.artist,album:row.album,year:Number(String(Array.isArray(tags.date)?tags.date[0]:tags.date??tags.year??0).slice(0,4))||0,profile:JSON.parse(row.profileJson),tags,score:0,reason:"",origin:"catalog"};
});
const cases=[
  {id:"late-night",prompt:"Make a late-night mix: atmospheric electronic music and trip-hop, a little dark and spacious, no rock or festival EDM.",correction:(items:PlaylistCandidate[])=>`Keep the first two songs exactly where they are. Replace the rest with calmer music. No more songs by ${items[2].artist}.`,check:(items:PlaylistCandidate[])=>items.every(item=>!(item.profile.genre as string[]??[]).includes("rock"))},
  {id:"instrumental-focus",prompt:"Instrumental jazz for focused work, warm and relaxed rather than hectic. No singing or spoken word.",correction:()=>"Make it strictly instrumental piano jazz; no vocals, no electronic music. Keep it relaxed.",check:(items:PlaylistCandidate[])=>items.every(item=>JSON.stringify(item.profile.vocalProfile).includes("instrumental")&&(item.profile.genre as string[]??[]).includes("jazz"))},
  {id:"guitar-road-trip",prompt:"A guitar-based road-trip mix from the 1990s: alternative rock and punk, energetic but no metal. Include Green Day if available.",correction:()=>"Make it all Green Day, from the 1990s, and put Basket Case first if you have it. No other artists.",check:(items:PlaylistCandidate[])=>items.every(item=>item.year>=1990&&item.year<=1999&&!(item.profile.genre as string[]??[]).includes("metal"))},
];
const report:{generatedAt:string;model:string;libraryTracks:number;runs:Array<Record<string,unknown>>;summary?:Record<string,unknown>}={generatedAt:new Date().toISOString(),model:credentials.model,libraryTracks:library.length,runs:[]};
const output=process.env.PLAYLIST_EVAL_OUTPUT??"delivery/playlist-chat-evaluation";
await mkdir(output,{recursive:true});
for(const scenario of cases){
  let current:PlaylistCandidate[]=[], messages:ChatMessage[]=[], guidance="",name="";
  for(const stage of ["initial","correction"]){
    if(stage==="correction"&&!current.length)break;
    const message=stage==="initial"?scenario.prompt:scenario.correction(current),before=current,started=Date.now();
    console.log(`${scenario.id} ${stage}: ${message}`);
    try{
      const result=await suggestChatPlaylist({client,library,messages,message,targetTracks:8,current,guidance,name});
      const checks=[{name:"requested song count",passed:result.items.length===8},{name:"real unique library recordings",passed:new Set(result.items.map(item=>item.fileId)).size===result.items.length},{name:"library tool use",passed:result.detail.tools.some(tool=>tool.name==="search_library")},{name:"initial musical constraints",passed:stage==="correction"&&scenario.id==="guitar-road-trip"||scenario.check(result.items)}];
      if(stage==="correction"&&scenario.id==="late-night")checks.push({name:"kept first two in place",passed:result.items[0].fileId===before[0].fileId&&result.items[1].fileId===before[1].fileId},{name:"removed excluded artist",passed:result.items.every(item=>item.artist!==before[2].artist)});
      if(stage==="correction"&&scenario.id==="guitar-road-trip")checks.push({name:"only requested artist and decade",passed:result.items.every(item=>item.artist==="Green Day"&&item.year>=1990&&item.year<=1999)},{name:"requested opener",passed:result.items[0].title.toLowerCase()==="basket case"});
      if(stage==="correction"&&scenario.id==="instrumental-focus")checks.push({name:"piano instrumentation and no electronic genre",passed:result.items.every(item=>JSON.stringify(item.profile.instrumentation).includes("piano")&&!(item.profile.genre as string[]??[]).includes("electronic"))});
      report.runs.push({scenario:scenario.id,stage,message,...result,checks});
      current=result.items;guidance=result.guidance;name=result.name;messages=[...messages,{role:"user",content:message},{role:"assistant",content:result.reply}];
      console.log(JSON.stringify({durationMs:result.detail.durationMs,tokens:result.detail.usage.total_tokens,checks,songs:current.map(item=>`${item.artist} — ${item.title}`)}));
    }catch(error){report.runs.push({scenario:scenario.id,stage,message,durationMs:Date.now()-started,error:String(error)});console.log(`${scenario.id} ${stage}: ${String(error)}`)}
    await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
  }
}
const completed=report.runs.filter(run=>!run.error&&run.detail),latencies=completed.map(run=>(run.detail as {durationMs:number}).durationMs);
const passed=completed.filter(run=>(run.checks as Array<{passed:boolean}>).every(check=>check.passed));
report.summary={turns:report.runs.length,completedTurns:completed.length,passedTurns:passed.length,meanLatencyMs:Math.round(latencies.reduce((sum,value)=>sum+value,0)/Math.max(1,latencies.length)),minLatencyMs:Math.min(...latencies),maxLatencyMs:Math.max(...latencies),totalTokens:completed.reduce((sum,run)=>sum+(run.detail as {usage:{total_tokens:number}}).usage.total_tokens,0),scope:"Constraint checks use existing library metadata, not audio or subjective musical quality. Evaluation does not modify production playlists."};
await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
if(passed.length!==report.runs.length)process.exitCode=1;
console.log(`Report: ${output}/report.json`);

}
void main().catch(error=>{console.error(String(error));process.exitCode=1});
