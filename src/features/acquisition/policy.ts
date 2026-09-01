import type { AcquisitionTarget,ControllerMode,DownloadObservation,InterventionDecision } from "./types";
const hour=3_600_000;
export const hoursSince=(value?:string|null)=>value?Math.max(0,(Date.now()-new Date(value.endsWith("Z")?value:`${value.replace(" ","T")}Z`).getTime())/hour):Infinity;
export function controllerMode(migration:number,incomplete:number,stableHours:number,threshold=25,incompleteThreshold=20):ControllerMode{return migration<=threshold&&incomplete<=incompleteThreshold&&stableHours>=24?"completion":"bulk"}
export function stalledDecision(target:AcquisitionTarget,now:DownloadObservation,previous?:DownloadObservation,ageHours=0):InterventionDecision|null{
  const progressed=Boolean(previous&&now.downloaded>previous.downloaded);
  if(progressed||now.speed>0||now.connectedSeeds>0)return null;
  const metadata=now.progress===0&&now.amountLeft===0;
  if(metadata&&ageHours>=2)return{action:"replace",reason:"Magnet metadata remained unavailable after reannounces",destructive:true,targetId:target.id,hash:now.hash};
  const idle=hoursSince(target.last_progress_at??target.first_queued_at);
  const grace=target.origin==="migration"?(now.progress>=.9?48:24):72;
  if(idle>=grace&&ageHours>=grace&&now.availability<=now.progress)return{action:"replace",reason:`No byte progress or reachable source for ${grace} hours`,destructive:true,targetId:target.id,hash:now.hash};
  return null;
}
export function releaseScore(item:{seeders:number;size:number;trackCount:number;quality:string;sourceScore:number;importRate:number}){
  const lossless=/flac|alac|ape|wavpack/i.test(item.quality),mp3=/mp3.*(v0|320)/i.test(item.quality);
  if(!lossless&&!mp3)return-Infinity;
  const bytesPerTrack=Math.max(1,item.size/Math.max(1,item.trackCount));
  return Math.log2(item.seeders+1)*28+Math.log2(item.trackCount+1)*9-Math.log2(bytesPerTrack/1e6+1)*5+item.sourceScore*20+item.importRate*20+(lossless?12:0);
}
export function retryDelay(attempts:number){return attempts<=1?6:attempts===2?24:72}
