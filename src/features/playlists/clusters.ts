import { createHash } from "node:crypto";
import { db, stateGet, stateSet } from "@/features/db/client";
import { navidromeListeningProfile } from "@/features/integrations/navidrome";
import { defaultConfig, type PlaylistCategory } from "./types";

const values=(record:Record<string,unknown>,key:string):string[]=>Array.isArray(record[key])?(record[key] as unknown[]).map(String):[];
const norm=(value:string)=>value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

export async function refreshListeningClusters(ownerUserId?: number){
  if(!ownerUserId)return 0;
  const listening=await navidromeListeningProfile(ownerUserId).catch(()=>({frequent:[],starred:[]}));
  const signals=new Map<string,number>();
  for(const item of listening.frequent as Array<Record<string,unknown>>){
    const playCount=Math.max(0,Number(item.playCount??0));
    const played=String(item.played??"");
    if(!playCount&&!played)continue;
    const key=`${norm(String(item.artist??""))}|${norm(String(item.name??item.album??""))}`;
    if(key==="|")continue;
    signals.set(key,(signals.get(key)??0)+Math.log1p(playCount)*24+(played?6:0));
  }
  for(const item of listening.starred as Array<Record<string,unknown>>){
    const key=`${norm(String(item.artist??""))}|${norm(String(item.album??""))}`;
    if(key==="|")continue;
    signals.set(key,(signals.get(key)??0)+35);
  }
  const rows=db().prepare("SELECT a.album_key,a.profile_json,min(f.artist_name) artist,min(f.album_name) album FROM album_profiles a JOIN files f ON f.album_key=a.album_key GROUP BY a.album_key").all() as Array<{profile_json:string;artist:string;album:string}>;
  const scores=new Map<string,{weight:number;evidence:string[]}>();
  for(const row of rows){const listen=signals.get(`${norm(row.artist)}|${norm(row.album)}`)??0;if(!listen)continue;let profile:Record<string,unknown>;try{profile=JSON.parse(row.profile_json) as Record<string,unknown>}catch{continue}for(const term of [...values(profile,"genre"),...values(profile,"style"),...values(profile,"scenes")].slice(0,10)){const key=norm(term);if(!key)continue;const current=scores.get(key)??{weight:0,evidence:[]};current.weight+=listen;current.evidence.push(`${row.artist} / ${row.album}`);scores.set(key,current)}}
  const selected=[...scores.entries()].sort((a,b)=>b[1].weight-a[1].weight).slice(0,10);
  db().transaction(()=>{db().prepare("DELETE FROM listening_clusters WHERE user_id=?").run(ownerUserId);const insert=db().prepare("INSERT INTO listening_clusters(id,label,terms_json,evidence_json,weight,user_id) VALUES (?,?,?,?,?,?)");for(const[key,value]of selected)insert.run(createHash("sha1").update(`${ownerUserId}:${key}`).digest("hex").slice(0,12),key.replace(/\b\w/g,char=>char.toUpperCase()),JSON.stringify([key]),JSON.stringify({albums:[...new Set(value.evidence)].slice(0,12)}),value.weight,ownerUserId)})();
  stateSet(`listening_clusters_refreshed:${ownerUserId}`,new Date().toISOString());
  return selected.length;
}

export async function playlistSuggestions(ownerUserId?:number){
  if(ownerUserId){const refreshed=Date.parse(stateGet(`listening_clusters_refreshed:${ownerUserId}`));if(!Number.isFinite(refreshed)||Date.now()-refreshed>6*60*60*1000)await refreshListeningClusters(ownerUserId)}
  const clusters=ownerUserId?db().prepare("SELECT id,label,terms_json,weight FROM listening_clusters WHERE user_id=? ORDER BY weight DESC LIMIT 8").all(ownerUserId) as Array<{id:string;label:string;terms_json:string;weight:number}>:[];
  const suggestions:Array<Record<string,unknown>>=[];
  for(const cluster of clusters.slice(0,5)){const lane=JSON.parse(cluster.terms_json) as string[];suggestions.push(suggestion("discovery",`New in ${cluster.label}`,lane,cluster.id),suggestion("depth",`${cluster.label} Deep Dive`,lane,cluster.id))}
  for(const[name,moods,contexts]of [["Late Night",["atmospheric","dreamy"],["late_night"]],["Focus",["calm","reflective"],["focus","reading"]],["Energy",["triumphant","urgent"],["workout","driving"]],["Wind Down",["calm","melancholic"],["relaxation"]]] as const)suggestions.push({...suggestion("mood",name,[],name),config:{...defaultConfig("mood"),moods:[...moods],contexts:[...contexts]}});
  suggestions.push({...suggestion("journey","Slow Burn",[],"slow-burn"),config:{...defaultConfig("journey"),energyCurve:"slow_burn"}},{...suggestion("journey","Night Drive Arc",[],"night-drive"),config:{...defaultConfig("journey"),contexts:["driving","late_night"],energyCurve:"wave"}});
  if(clusters.length)suggestions.push(suggestion("rediscovery","Forgotten Favorites",[],"forgotten"));
  return{clusters,suggestions};
}
function suggestion(category:PlaylistCategory,name:string,lanes:string[],key:string){return{key:`${category}:${key}`,name,category,intent:"",enabled:true,config:{...defaultConfig(category),tasteLanes:lanes,genres:lanes}}}
