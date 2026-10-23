// A deliberate refill may bypass the ordinary research cadence, never provider
// Retry-After, request budgets, musical fit, identity checks or acquisition caps.
import {config} from '../src/config';
import {db,stateGet,stateSet} from '../src/features/db/client';
import {getPlaylist} from '../src/features/playlists/repository';
import {currentDiscoveryPoolSize,discoveryPoolTarget} from '../src/features/playlists/discovery-repository';
import {runDiscoveryMaintenance} from '../src/features/playlists/discovery-research';
import {musicBrainzCooldownRemaining} from '../src/features/sources/musicbrainz';

let database:ReturnType<typeof db>|undefined;
async function main(){
  if(config.DATABASE_PATH!=='/app/data/curator.sqlite'||process.env.PLAYLIST_ROLLOUT_APPLY!=='true')throw Error('Production path or apply guard failed');
  database=db();
  if(stateGet('playlist_refresh_mode')!=='enabled'||stateGet('paused')==='true')throw Error('Enabled-mode or pause guard failed');
  const batch=process.env.PLAYLIST_REFRESH_BATCH,id=Number(process.env.PLAYLIST_DISCOVERY_PLAYLIST);
  if(!batch||!/^[a-zA-Z0-9_-]{8,100}$/.test(batch)||!Number.isInteger(id)||id<=0)throw Error('Supply an explicit stable batch name and playlist ID');
  const p=getPlaylist(id);if(!p?.enabled||p.category!=='discovery')throw Error('Choose an enabled discovery playlist');
  const key='playlist_discovery_operator:'+batch+':'+id+':'+p.revision;
  if(stateGet(key)){console.log(JSON.stringify({alreadyCompleted:true,receipt:JSON.parse(stateGet(key))}));return}
  const retryAt=Math.max(Number(stateGet('playlist_source_cooldown:musicbrainz','0')),Date.now()+musicBrainzCooldownRemaining());
  if(retryAt>Date.now())throw Error('MusicBrainz cooldown is still active; retry after '+new Date(retryAt).toISOString());
  const before=currentDiscoveryPoolSize(p);
  if(before<discoveryPoolTarget)stateSet('playlist_research_next:'+id,'0');
  await runDiscoveryMaintenance();
  const receipt={at:new Date().toISOString(),playlistId:id,revision:p.revision,before,after:currentDiscoveryPoolSize(p),research:JSON.parse(stateGet('playlist_research_outcome:'+id,'null')),error:stateGet('playlist_discovery_error')};
  stateSet(key,JSON.stringify(receipt));console.log(JSON.stringify(receipt));
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Discovery trigger failed');process.exitCode=1}).finally(()=>database?.close());
