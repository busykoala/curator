import { stateGet } from "@/features/db/client";
import { artist,createProfile,profiles,updateArtist } from "./lidarr";

function configure(item:Record<string,unknown>):Record<string,unknown>{
  const quality=item.quality as{name?:string}|undefined,children=item.items as Record<string,unknown>[]|undefined;
  if(quality)return{...item,allowed:/^(FLAC|FLAC 24bit|MP3-VBR-V0|MP3-320)$/i.test(quality.name??"")};
  if(children){const items=children.map(configure);return{...item,items,allowed:items.some(child=>child.allowed===true)}}
  return item;
}
export async function hybridProfileId(){const list=await profiles(),existing=list.find(item=>item.name==="Curator Migration Hybrid");if(existing)return existing.id;const lossless=list.find(item=>item.name.toLowerCase()==="lossless")??list[0];if(!lossless)throw new Error("No Lidarr quality profile exists");const clone=structuredClone(lossless) as Record<string,unknown>;delete clone.id;clone.name="Curator Migration Hybrid";clone.upgradeAllowed=true;clone.items=(clone.items as Record<string,unknown>[]).map(configure);return(await createProfile(clone)).id}
export async function withHybrid<T>(artistId:number,work:()=>Promise<T>){const row=await artist(artistId),original=row.qualityProfileId,hybrid=await hybridProfileId();if(original!==hybrid)await updateArtist({...row,qualityProfileId:hybrid});try{return await work()}finally{if(original!==hybrid)await updateArtist({...row,qualityProfileId:original})}}
export function sourceScores(){try{return JSON.parse(stateGet("source_scores","[]")) as Array<{name:string;score:number}>}catch{return[]}}
