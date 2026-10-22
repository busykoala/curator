import {createHash} from 'node:crypto';
import {stateGet,stateSet} from '@/features/db/client';
import {listPlaylists} from './repository';
import {discoveryRecommendations,discoveryPoolTarget,storeDiscoveryRecommendation,type DiscoveryRelease} from './discovery-repository';
import {editorialCandidates,lastFmCandidates,listenBrainzCandidates} from './discovery-providers';
import {queueDiscoveryRecommendations,refreshDiscoveryLifecycle} from './discovery-lifecycle';
import type {PlaylistDefinition} from './types';
import {playlistRefreshMode,refreshManaged} from './refresh-jobs';

const providers=[{name:'listenbrainz',load:listenBrainzCandidates},{name:'editorial',load:editorialCandidates},{name:'lastfm',load:lastFmCandidates}];
export function discoveryPoolNeedsResearch(playlist:PlaylistDefinition,now=Date.now()){
  return discoveryRecommendations(playlist.id,playlist.ownerUserId).filter(r=>['researched','queued','downloading','ready'].includes(r.status)).length<discoveryPoolTarget&&Number(stateGet(`playlist_research_next:${playlist.id}`,'0'))<=now;
}
function usableEvidence(release:DiscoveryRelease){
  if(!release.identityVerified||!release.evidence.length)return false;
  const identity=release.evidence.some(e=>e.provider==='musicbrainz'&&e.claims.releaseGroupId===release.id&&e.claims.album===release.album);
  const recommendation=release.evidence.some(e=>e.provider!=='musicbrainz'&&['artist','recording','release'].includes(e.scope)&&Object.keys(e.claims).length>0);
  const date=release.releaseDate?Date.parse(release.releaseDate):NaN;
  return identity&&recommendation&&(!Number.isFinite(date)||date<=Date.now());
}
export async function researchDiscoveryPools(adapters=providers,now=new Date()){
  const playlists=listPlaylists().filter(p=>p.enabled&&(playlistRefreshMode()!=='canary'||refreshManaged(p.id))&&(p.category==='discovery'||p.category==='depth'&&p.config.externalDiscovery)&&discoveryPoolNeedsResearch(p,now.getTime()));
  if(!playlists.length)return{researched:0,queued:0};
  const cursor=Number(stateGet('playlist_research_cursor','0'))%playlists.length,playlist=playlists[cursor];
  const cycle=Number(stateGet(`playlist_research_cycles:${playlist.id}`,'0'));
  const recent=cycle%4===3;let researched=0;
  const outcomes:Array<{provider:string;candidates:number;error?:string}>=[];
  for(const provider of adapters){
    try{
      const releases=await provider.load(playlist,recent);let accepted=0;
      for(const release of releases){
        if(!usableEvidence(release))continue;
        if(recent&&(!release.releaseDate||Date.parse(release.releaseDate)<now.getTime()-120*86400_000))continue;
        const existing=discoveryRecommendations(playlist.id,playlist.ownerUserId);
        if(existing.some(r=>r.release_id===release.id))continue;
        if(existing.filter(r=>['researched','queued','downloading','ready'].includes(r.status)).length>=discoveryPoolTarget)break;
        const recommendation=release.evidence.find(e=>e.provider!=='musicbrainz')!;
        const reason=recommendation.claims.seedArtist?`Recommended from ${String(recommendation.claims.seedArtist)} by ${recommendation.provider}`:`Supported by ${recommendation.provider} release evidence`;
        const origin=provider.name==='listenbrainz'&&recommendation.claims.explorationMode==='medium'?'listenbrainz-adjacent':provider.name;
        storeDiscoveryRecommendation(playlist,release,reason,origin);researched++;accepted++;
      }
      outcomes.push({provider:provider.name,candidates:accepted});
    }catch(error){outcomes.push({provider:provider.name,candidates:0,error:String(error).slice(0,250)})}
  }
  const jitter=parseInt(createHash('sha256').update(`${playlist.id}:${now.toISOString().slice(0,10)}:${cycle}`).digest('hex').slice(0,6),16)%(30*60_000);
  stateSet(`playlist_research_next:${playlist.id}`,String(now.getTime()+2*3600_000+jitter));
  stateSet(`playlist_research_cycles:${playlist.id}`,String(cycle+1));
  stateSet('playlist_research_cursor',String((cursor+1)%playlists.length));
  stateSet(`playlist_research_outcome:${playlist.id}`,JSON.stringify({at:now.toISOString(),recent,outcomes}));
  return{researched,queued:0};
}
let maintenanceRunning=false;
export async function runDiscoveryMaintenance(){
  if(maintenanceRunning||stateGet('paused')==='true')return;
  maintenanceRunning=true;
  try{
    await refreshDiscoveryLifecycle();
    await queueDiscoveryRecommendations();
    await researchDiscoveryPools();
    stateSet('playlist_discovery_error','');
  }catch(error){stateSet('playlist_discovery_error',String(error))}
  finally{maintenanceRunning=false}
}
