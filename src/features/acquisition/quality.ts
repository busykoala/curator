import { db, stateGet, stateSet } from "@/features/db/client";
import { artist,createProfile,profiles,updateArtist } from "./lidarr";

function configure(item:Record<string,unknown>):Record<string,unknown>{
  const quality=item.quality as{name?:string}|undefined,children=item.items as Record<string,unknown>[]|undefined;
  if(quality)return{...item,allowed:/^(FLAC|FLAC 24bit|MP3-VBR-V0|MP3-320)$/i.test(quality.name??"")};
  if(children){const items=children.map(configure);return{...item,items,allowed:items.some(child=>child.allowed===true)}}
  return item;
}
export async function hybridProfileId(){const list=await profiles(),existing=list.find(item=>item.name==="Curator Migration Hybrid");if(existing)return existing.id;const lossless=list.find(item=>item.name.toLowerCase()==="lossless")??list[0];if(!lossless)throw new Error("No Lidarr quality profile exists");const clone=structuredClone(lossless) as Record<string,unknown>;delete clone.id;clone.name="Curator Migration Hybrid";clone.upgradeAllowed=true;clone.items=(clone.items as Record<string,unknown>[]).map(configure);return(await createProfile(clone)).id}
const artistWork=new Map<number,Promise<unknown>>();
export async function recoverQualityProfiles(){
  const rows=db().prepare("SELECT key,value FROM state WHERE key LIKE 'acquisition_restore_profile:%'").all() as Array<{key:string;value:string}>;
  for(const saved of rows){
    const {artistId,original,hybrid}=JSON.parse(saved.value) as {artistId:number;original:number;hybrid:number};
    const current=await artist(artistId);
    if(current.qualityProfileId===hybrid)await updateArtist({...current,qualityProfileId:original});
    db().prepare('DELETE FROM state WHERE key=?').run(saved.key);
  }
}
export async function withHybrid<T>(artistId:number,work:()=>Promise<T>):Promise<T>{
  const before=artistWork.get(artistId)??Promise.resolve();
  const next=before.catch(()=>{}).then(async()=>{
    const row=await artist(artistId),original=row.qualityProfileId,hybrid=await hybridProfileId(),key=`acquisition_restore_profile:${artistId}`;
    if(original!==hybrid){stateSet(key,JSON.stringify({artistId,original,hybrid}));await updateArtist({...row,qualityProfileId:hybrid})}
    try{return await work()}finally{
      if(original!==hybrid){
        const current=await artist(artistId);
        if(current.qualityProfileId===hybrid)await updateArtist({...current,qualityProfileId:original});
        db().prepare('DELETE FROM state WHERE key=?').run(key);
      }
    }
  });
  artistWork.set(artistId,next);
  try{return await next}finally{if(artistWork.get(artistId)===next)artistWork.delete(artistId)}
}
export function sourceScores(){try{return JSON.parse(stateGet("source_scores","[]")) as Array<{name:string;score:number}>}catch{return[]}}
