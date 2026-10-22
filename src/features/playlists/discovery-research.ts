import {createHash} from 'node:crypto';
import {stateGet,stateSet} from '@/features/db/client';
import {listPlaylists} from './repository';
import {discoveryRecommendations,discoveryPoolTarget,storeDiscoveryRecommendation,verifiedDiscoveryRecommendation,currentDiscoveryPoolSize,type DiscoveryRelease} from './discovery-repository';
import {editorialCandidates,lastFmCandidates,listenBrainzCandidates,listenBrainzTagCandidates} from './discovery-providers';
import {queueDiscoveryRecommendations,refreshDiscoveryLifecycle} from './discovery-lifecycle';
import type {PlaylistDefinition} from './types';
import {playlistRefreshMode,refreshManaged} from './refresh-jobs';
import {compilePlaylistIntent} from './intent-compiler';
import {discoveryReleaseFit} from './discovery-fit';
import {discoveryResearchDirection,revalidateDiscoveryDirection} from './discovery-direction-state';

const providers=[{name:'listenbrainz',load:listenBrainzCandidates},{name:'listenbrainz-tags',load:listenBrainzTagCandidates},{name:'editorial',load:editorialCandidates},{name:'lastfm',load:lastFmCandidates}];
export function discoveryPoolNeedsResearch(playlist:PlaylistDefinition,now=Date.now()){
  return Number(stateGet(`playlist_research_revision:${playlist.id}`,'0'))!==(playlist.revision??1)||currentDiscoveryPoolSize(playlist)<discoveryPoolTarget&&Number(stateGet(`playlist_research_next:${playlist.id}`,'0'))<=now;
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
  // Reserve the fair cursor and a short failure backoff before interpretation.
  // One invalid description must not starve every other listener's research.
  stateSet('playlist_research_cursor',String((cursor+1)%playlists.length));
  stateSet(`playlist_research_revision:${playlist.id}`,String(playlist.revision??1));
  stateSet(`playlist_research_next:${playlist.id}`,String(now.getTime()+15*60_000));
  const compiled=await compilePlaylistIntent(playlist,[]),direction=discoveryResearchDirection(playlist,compiled.intent);
  revalidateDiscoveryDirection(playlist,compiled.intent);
  const recent=cycle%4===3;let researched=0;
  const outcomes:Array<{provider:string;candidates:number;error?:string}>=[];
  for(const provider of adapters){
    if(currentDiscoveryPoolSize(playlist)>=discoveryPoolTarget)break;
    try{
      const releases=await provider.load(direction,recent);let accepted=0;
      for(const release of releases){
        if(!usableEvidence(release))continue;
        const fit=discoveryReleaseFit(direction,release,compiled.intent);if(!fit)continue;
        if(recent&&(!release.releaseDate||Date.parse(release.releaseDate)<now.getTime()-120*86400_000))continue;
        const existing=discoveryRecommendations(playlist.id,playlist.ownerUserId);
        const prior=existing.find(r=>r.release_id===release.id);
        if(prior&&(prior.direction_revision===(playlist.revision??1)&&verifiedDiscoveryRecommendation(prior)||['dismissed','presented','deferred'].includes(prior.status)))continue;
        if(currentDiscoveryPoolSize(playlist)>=discoveryPoolTarget)break;
        const recommendation=release.evidence.find(e=>e.provider!=='musicbrainz')!;
        const reason=recommendation.claims.seedArtist?`Recommended from ${String(recommendation.claims.seedArtist)} by ${recommendation.provider}`:`Supported by ${recommendation.provider} release evidence`;
        const origin=fit.lane==='adjacent'?provider.name+'-adjacent':provider.name;
        storeDiscoveryRecommendation(playlist,release,reason+' · '+fit.reason,origin);researched++;accepted++;
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
export async function runDiscoveryMaintenance(stages={lifecycle:refreshDiscoveryLifecycle,admit:queueDiscoveryRecommendations,research:researchDiscoveryPools}){
  if(maintenanceRunning||stateGet('paused')==='true')return;
  maintenanceRunning=true;
  try{
    const errors:string[]=[];
    try{await stages.lifecycle();await stages.admit()}catch(error){errors.push('acquisition: '+String(error))}
    // Discovery research is independent of Lidarr, qBittorrent and imports.
    // A dependency outage must not empty or freeze the recommendation pool.
    try{await stages.research()}catch(error){errors.push('research: '+String(error))}
    stateSet('playlist_discovery_error',errors.join('; '));
  }catch(error){stateSet('playlist_discovery_error',String(error))}
  finally{maintenanceRunning=false}
}
