import OpenAI from "openai";
import { config } from "@/config";
import { semanticBatchJsonSchema,semanticBatchSchema } from "./schema";
import { normalizeProfile,profileIsSparse } from "./vocabulary";
import { canonicalPrompt } from "./canonical";
import type { TrackClassificationInput,TrackSemanticProfile } from "./types";
import { recordAiUsage } from "@/features/ai/usage";

const instructions=`Categorize each supplied recording independently for long-term music discovery. Return strict structured data only. Keep every dimension conceptually distinct and preserve track differences within an album.
GENRE must stay broad: rock, pop, electronic, hip_hop, rnb_soul_funk, jazz, classical, folk_acoustic, country_americana, metal, punk_hardcore, reggae_dub_ska, latin, african, middle_eastern_north_african, south_asian, east_southeast_asian, ambient, experimental_avant_garde, soundtrack_score, spoken_word_comedy, religious_spiritual, childrens, blues, or another genuinely broad family. Put subgenres in STYLE.
Use reusable categorical terms, not track-specific prose compounds. Established STYLE and INSTRUMENTATION terms may extend the examples when musically necessary. Prefer canonical MOOD, GROOVE, TEXTURE, TIMBRE, PRODUCTION, LISTENING_CONTEXT, DYNAMIC, STRUCTURAL, and RECORDING_TYPE terms over invented phrases. STYLE_ERA should be a decade, pre_1950s, contemporary, or era_ambiguous, not an actual year or a style name. Do not place instrument names in TIMBRE, language or gender in VOCAL_PROFILE, production descriptions in RECORDING_TYPE, or energy words in MOOD.
Make a reasonable best estimate instead of leaving normal-song core dimensions empty, but leave genuinely inapplicable dimensions empty. Instrumentals need no language or lyrical themes. Do not infer or mention performer gender, age, ethnicity, or other sensitive traits in any field, summary, or evidence note. Describe only audible vocal technique. Never assign or mention album/playlist roles such as opener, builder, peak, or closer. Do not implement recommendations, similarity, sequencing, or playlist concepts. Treat audio features as evidence, not mechanical truth, and reconcile them with embedded, factual, editorial, and album evidence. When tempoCandidates differ by half or double time, choose the musically conventional BPM instead of mechanically copying estimatedBpm. Do not derive detailed lyrical themes from a title alone. Evidence notes must be concise and must not claim unsupported facts.
Use these stable values exactly for the listed subjective dimensions. STYLE, INSTRUMENTATION, SCENES, and factual LANGUAGE remain extensible:
${canonicalPrompt}`;

function compact(value:unknown,key:string):unknown{const limit=key==="lyrics"?3000:800;if(typeof value==="string")return value.slice(0,limit);if(Array.isArray(value))return value.slice(0,12).map(item=>typeof item==="string"?item.slice(0,limit):item);if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).slice(0,20).map(([name,item])=>[name,compact(item,name)]));return value}
function payload(track:TrackClassificationInput){const tags=Object.fromEntries(Object.entries(track.file.tags).filter(([key])=>["title","artist","artists","album","albumArtist","date","year","genre","style","mood","scene","composer","label","bpm","key","lyrics","comment","trackNumber","discNumber"].includes(key)).slice(0,30).map(([key,value])=>[key,compact(value,key)]));return{fileId:track.file.id,artist:track.file.artist,album:track.file.album,path:track.file.path.replace(/^\/music\//,""),tags,audio:track.audio}}

async function request(model:string,effort:"low"|"medium",tracks:TrackClassificationInput[],albumEvidence:Record<string,unknown>){
  const client=new OpenAI({apiKey:config.OPENAI_API_KEY});const response=await client.responses.create({model,instructions,input:JSON.stringify({albumEvidence,tracks:tracks.map(payload)}),reasoning:{effort},text:{format:{type:"json_schema",name:"track_semantic_profiles",strict:true,schema:semanticBatchJsonSchema}},store:false});recordAiUsage("track_categorization",model,response);return semanticBatchSchema.parse(JSON.parse(response.output_text));
}

export async function classifyTracks(tracks:TrackClassificationInput[],albumEvidence:Record<string,unknown>):Promise<Map<number,{profile:TrackSemanticProfile;model:string}>>{
  if(!config.OPENAI_API_KEY)throw new Error("OPENAI_API_KEY is not configured");let result,model=config.OPENAI_LUNA_MODEL,usedTerra=false;
  try{result=await request(model,"low",tracks,albumEvidence)}catch{model=config.OPENAI_TERRA_MODEL;usedTerra=true;result=await request(model,"medium",tracks,albumEvidence)}
  const expected=new Set(tracks.map(track=>track.file.id)),output=new Map<number,{profile:TrackSemanticProfile;model:string}>();for(const item of result.tracks)if(expected.has(item.fileId))output.set(item.fileId,{profile:normalizeProfile(item.profile),model});
  const retry=tracks.filter(track=>{const decision=output.get(track.file.id);return !decision||profileIsSparse(decision.profile)});if(retry.length&&!usedTerra)try{const escalated=await request(config.OPENAI_TERRA_MODEL,"medium",retry,albumEvidence);for(const item of escalated.tracks)if(expected.has(item.fileId))output.set(item.fileId,{profile:normalizeProfile(item.profile),model:config.OPENAI_TERRA_MODEL})}catch{}
  return output;
}
