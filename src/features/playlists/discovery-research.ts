import {createHash} from 'node:crypto';
import {db,stateGet,stateSet} from '@/features/db/client';
import {listPlaylists} from './repository';
import {discoveryRecommendations,discoveryPoolTarget,storeDiscoveryRecommendation,verifiedDiscoveryRecommendation,currentDiscoveryPoolSize,type DiscoveryRelease} from './discovery-repository';
import {editorialCandidates,lastFmCandidates,listenBrainzCandidates,listenBrainzTagCandidates,cachedDiscoveryCandidates} from './discovery-providers';
import {queueDiscoveryRecommendations,refreshDiscoveryLifecycle} from './discovery-lifecycle';
import type {PlaylistDefinition} from './types';
import {playlistRefreshMode,refreshManaged} from './refresh-jobs';
import {compilePlaylistIntent} from './intent-compiler';
import {discoveryReleaseFit} from './discovery-fit';
import {discoveryResearchDirection,revalidateDiscoveryDirection} from './discovery-direction-state';

type DiscoveryProvider={name:string;load:(playlist:PlaylistDefinition,recent:boolean)=>Promise<DiscoveryRelease[]>};
const providers:DiscoveryProvider[]=[{name:'cached-radio',load:cachedDiscoveryCandidates},{name:'listenbrainz',load:listenBrainzCandidates},{name:'listenbrainz-tags',load:listenBrainzTagCandidates},{name:'editorial',load:editorialCandidates},{name:'lastfm',load:lastFmCandidates}];
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
export async function researchDiscoveryPools(adapters:DiscoveryProvider[]=providers,now=new Date()){
  const began=Date.now();
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
        const originProvider=provider.name==='cached-radio'?recommendation.provider:provider.name;
        const origin=fit.lane==='adjacent'?originProvider+'-adjacent':originProvider;
        storeDiscoveryRecommendation(playlist,release,reason+' · '+fit.reason,origin);researched++;accepted++;
      }
      outcomes.push({provider:provider.name,candidates:accepted});
    }catch(error){outcomes.push({provider:provider.name,candidates:0,error:String(error).slice(0,250)})}
  }
  const jitter=parseInt(createHash('sha256').update(`${playlist.id}:${now.toISOString().slice(0,10)}:${cycle}`).digest('hex').slice(0,6),16)%(30*60_000);
  const finished=now.getTime()+Math.max(0,Date.now()-began),underfilled=currentDiscoveryPoolSize(playlist)<discoveryPoolTarget;
  // A partial provider result can hide an identity-service deferral. Preserve
  // the actual dependency errors separately from a successful empty response.
  // Individual adapters still enforce their own cooldowns on every request;
  // an unavailable source must not delay trying the other sources for two hours.
  const deferredSources=(db().prepare(`SELECT c.key,coalesce(nullif(e.value,''),'Provider cooldown active') error,c.value retry_at FROM state c LEFT JOIN state e
    ON e.key='playlist_source_error:'||substr(c.key,length('playlist_source_cooldown:')+1)
    WHERE c.key LIKE 'playlist_source_cooldown:%' AND CAST(c.value AS INTEGER)>?`).all(finished) as Array<{key:string;error:string;retry_at:string}>)
    .map(row=>({provider:row.key.slice('playlist_source_cooldown:'.length),error:row.error,retryAt:new Date(Number(row.retry_at)).toISOString()}));
  const utcDay=new Date(finished).setUTCHours(0,0,0,0);
  const requestFailures=db().prepare("SELECT provider,detail,created_at FROM playlist_source_requests WHERE status='failed' AND created_at>=? ORDER BY id DESC LIMIT 20").all(began) as Array<{provider:string;detail:string;created_at:number}>;
  const requests=(db().prepare('SELECT count(*) n FROM playlist_source_requests WHERE created_at>=?').get(utcDay) as {n:number}).n;
  const budgetDeferred=underfilled&&requests>=100;
  const sourceDeferred=underfilled&&(deferredSources.length>0||requestFailures.length>0||outcomes.some(outcome=>outcome.error));
  const nextResearch=budgetDeferred?utcDay+86400_000+jitter%120_000:
    underfilled&&(sourceDeferred||researched>0)?finished+15*60_000+jitter%120_000:now.getTime()+2*3600_000+jitter;
  stateSet(`playlist_research_next:${playlist.id}`,String(nextResearch));
  stateSet(`playlist_research_cycles:${playlist.id}`,String(cycle+1));
  stateSet('playlist_research_cursor',String((cursor+1)%playlists.length));
  stateSet(`playlist_research_outcome:${playlist.id}`,JSON.stringify({at:now.toISOString(),recent,outcomes,
    availability:budgetDeferred?'budget_deferred':sourceDeferred?'source_deferred':researched?'available':'no_new_matches',
    deferredSources,requestFailures,nextResearchAt:new Date(nextResearch).toISOString()}));
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
