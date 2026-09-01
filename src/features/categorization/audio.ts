import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { execFile,spawn } from "node:child_process";
import { promisify } from "node:util";
import { db } from "@/features/db/client";
import { versions } from "@/config";
import type { AudioFeatures,CategorizationFile } from "./types";

const execute=promisify(execFile),RATE=8000,SECONDS=120,MAX_BYTES=RATE*SECONDS*4;

async function flacFingerprint(path:string):Promise<string>{
  const{stdout}=await execute("metaflac",["--show-md5sum",path],{timeout:20_000});
  const value=stdout.trim();if(!/^[a-f0-9]{32}$/i.test(value))throw new Error("FLAC audio MD5 is unavailable");return`flac:${value}`;
}

async function mp3Fingerprint(path:string,size:number):Promise<string>{
  const handle=await open(path,"r");let start=0,end=Math.max(0,size-1);
  try{const head=Buffer.alloc(10);await handle.read(head,0,10,0);if(head.subarray(0,3).toString()==="ID3")start=10+((head[6]&127)<<21|(head[7]&127)<<14|(head[8]&127)<<7|(head[9]&127));const tail=Buffer.alloc(128);if(size>=128){await handle.read(tail,0,128,size-128);if(tail.subarray(0,3).toString()==="TAG")end=size-129}}finally{await handle.close()}
  return new Promise((resolve,reject)=>{const hash=createHash("sha256"),stream=createReadStream(path,{start,end});stream.on("data",chunk=>hash.update(chunk));stream.on("error",reject);stream.on("end",()=>resolve(`mp3:${hash.digest("hex")}`))});
}

async function fingerprint(file:CategorizationFile):Promise<string>{return file.format.toLowerCase()==="flac"?flacFingerprint(file.path):mp3Fingerprint(file.path,file.size)}

async function decode(path:string):Promise<Float32Array>{return new Promise((resolve,reject)=>{
  const child=spawn("ffmpeg",["-v","error","-i",path,"-t",String(SECONDS),"-vn","-ac","1","-ar",String(RATE),"-f","f32le","pipe:1"],{stdio:["ignore","pipe","pipe"]});
  const chunks:Buffer[]=[],errors:Buffer[]=[];let bytes=0;const timer=setTimeout(()=>child.kill("SIGKILL"),90_000);
  child.stdout.on("data",(chunk:Buffer)=>{bytes+=chunk.length;if(bytes<=MAX_BYTES)chunks.push(chunk)});child.stderr.on("data",(chunk:Buffer)=>errors.push(chunk));child.on("error",reject);child.on("close",code=>{clearTimeout(timer);if(code!==0)return reject(new Error(Buffer.concat(errors).toString().slice(0,500)||`ffmpeg exited ${code}`));const buffer=Buffer.concat(chunks);resolve(new Float32Array(buffer.buffer,buffer.byteOffset,Math.floor(buffer.byteLength/4)))})
})}

function percentile(values:number[],p:number):number{if(!values.length)return-120;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))]}
function estimateTempo(envelope:number[],fps:number):{bpm:number|null;candidates:number[];regularity:number}{
  if(envelope.length<128)return{bpm:null,candidates:[],regularity:0};const smooth=envelope.map((value,index)=>(envelope[index-1]??value)+value+(envelope[index+1]??value)).map(value=>value/3),mean=smooth.reduce((a,b)=>a+b,0)/smooth.length,signal=smooth.map(value=>Math.max(0,value-mean*.25)),scores:Array<{lag:number;score:number;bpm:number}>=[];
  for(let lag=Math.ceil(fps*60/200);lag<=Math.floor(fps*60/50);lag++){let xy=0,xx=0,yy=0;for(let i=lag;i<signal.length;i++){const x=signal[i],y=signal[i-lag];xy+=x*y;xx+=x*x;yy+=y*y}const score=xy/Math.sqrt(xx*yy+1e-12);scores.push({lag,score:Number.isFinite(score)?score:0,bpm:60*fps/lag})}
  const ranked=[...scores].sort((a,b)=>b.score-a.score);if(!ranked.length||ranked[0].score<.08)return{bpm:null,candidates:[],regularity:0};let chosen=ranked[0];if(chosen.bpm>150){const half=scores.find(item=>item.lag===chosen.lag*2);if(half&&half.score>=chosen.score*.9)chosen=half}else if(chosen.bpm<75){const twice=scores.find(item=>item.lag===Math.round(chosen.lag/2));if(twice&&twice.score>=chosen.score*.97)chosen=twice}
  const index=scores.findIndex(item=>item.lag===chosen.lag),left=scores[index-1]?.score??chosen.score,right=scores[index+1]?.score??chosen.score,denominator=left-2*chosen.score+right,offset=Math.abs(denominator)>1e-9?Math.max(-.5,Math.min(.5,.5*(left-right)/denominator)):0,bpm=Math.max(50,Math.min(200,Math.round(60*fps/(chosen.lag+offset)*10)/10)),candidates:number[]=[];for(const item of ranked){const value=Math.round(item.bpm*10)/10;if(candidates.every(existing=>Math.abs(existing-value)>3))candidates.push(value);if(candidates.length===4)break}const baseline=percentile(scores.map(item=>item.score),.5),prominence=Math.max(0,(chosen.score-baseline)/Math.max(.05,1-baseline)),regularity=Math.max(0,Math.min(1,chosen.score*.65+prominence*.35));return{bpm,candidates,regularity};
}

function derive(samples:Float32Array):AudioFeatures{
  let sum=0,peak=0,crossings=0,diff=0;const blocks:number[]=[],envelope:number[]=[],block=RATE/2,onset=128;let blockSum=0,onsetSum=0,previousFrame=0;
  for(let i=0;i<samples.length;i++){const value=Number.isFinite(samples[i])?samples[i]:0,abs=Math.abs(value);sum+=value*value;peak=Math.max(peak,abs);if(i&&Math.sign(value)!==Math.sign(samples[i-1]))crossings++;if(i){const delta=value-samples[i-1];diff+=delta*delta}blockSum+=value*value;onsetSum+=value*value;if((i+1)%block===0){blocks.push(10*Math.log10(blockSum/block+1e-12));blockSum=0}if((i+1)%onset===0){const frame=Math.sqrt(onsetSum/onset);envelope.push(Math.max(0,frame-previousFrame));previousFrame=frame;onsetSum=0}}
  const rms=Math.sqrt(sum/Math.max(1,samples.length)),rmsDb=20*Math.log10(rms+1e-12),peakDb=20*Math.log10(peak+1e-12),dynamicRange=Math.max(0,percentile(blocks,.9)-percentile(blocks,.1));
  const tempo=estimateTempo(envelope,RATE/onset),high=Math.min(1,diff/(sum*4+1e-9)),energy=Math.max(0,Math.min(1,(rmsDb+35)/27*.75+high*.25)),dance=Math.max(0,Math.min(1,tempo.regularity*.7+(tempo.bpm&&tempo.bpm>=80&&tempo.bpm<=150?.3:.1)));
  return{analyzedSeconds:Math.round(samples.length/RATE*10)/10,sampleRate:RATE,rmsDb:Math.round(rmsDb*10)/10,peakDb:Math.round(peakDb*10)/10,dynamicRangeDb:Math.round(dynamicRange*10)/10,zeroCrossingRate:Math.round(crossings/Math.max(1,samples.length)*10000)/10000,highFrequencyRatio:Math.round(high*1000)/1000,estimatedBpm:tempo.bpm,tempoCandidates:tempo.candidates,beatRegularity:Math.round(tempo.regularity*1000)/1000,energy:Math.round(energy*1000)/1000,danceability:Math.round(dance*1000)/1000};
}

export async function analyzeAudio(file:CategorizationFile):Promise<{fingerprint:string;features:AudioFeatures}>{
  const audioFingerprint=await fingerprint(file),hit=db().prepare("SELECT features_json FROM audio_features WHERE file_id=? AND audio_fingerprint=? AND analyzer_version=?").get(file.id,audioFingerprint,versions.audioAnalysis) as{features_json:string}|undefined;
  if(hit)return{fingerprint:audioFingerprint,features:JSON.parse(hit.features_json) as AudioFeatures};const features=derive(await decode(file.path));db().prepare("INSERT INTO audio_features(file_id,audio_fingerprint,analyzer_version,features_json) VALUES (?,?,?,?) ON CONFLICT(file_id) DO UPDATE SET audio_fingerprint=excluded.audio_fingerprint,analyzer_version=excluded.analyzer_version,features_json=excluded.features_json,updated_at=CURRENT_TIMESTAMP").run(file.id,audioFingerprint,versions.audioAnalysis,JSON.stringify(features));return{fingerprint:audioFingerprint,features};
}
