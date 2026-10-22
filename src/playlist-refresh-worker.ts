import {pollPlaylistRefreshSchedule,runNextRefreshJob} from '@/features/playlists/refresh-worker';
import {runDiscoveryMaintenance} from '@/features/playlists/discovery-research';
import {playlistRefreshMode} from '@/features/playlists/refresh-jobs';
import {seedMetadataReviews,runMetadataReviews} from '@/features/playlists/metadata-review';
import {preparePlaylistEmbeddings} from '@/features/playlists/retrieval';
import {refreshListeningClusters} from '@/features/playlists/clusters';
import {db,stateGet} from '@/features/db/client';

let stopping=false;
const tick=()=>{try{pollPlaylistRefreshSchedule()}catch(error){console.error(JSON.stringify({event:'playlist_refresh_schedule_error',error:String(error)}))}};
let embedding=false;
const embed=()=>{if(!embedding&&playlistRefreshMode()!=='off'){
  embedding=true;void preparePlaylistEmbeddings().catch(error=>console.error(JSON.stringify({event:'playlist_embeddings_error',error:String(error)}))).finally(()=>{embedding=false});
}};
tick();const timer=setInterval(()=>{tick();embed()},60_000);
let maintaining=false;
async function listenerMaintenance(){
  const owners=db().prepare('SELECT DISTINCT owner_user_id id FROM smart_playlists WHERE enabled=1').all() as Array<{id:number}>;
  for(const owner of owners){
    if(db().prepare("SELECT 1 FROM playlist_chat_jobs WHERE status IN ('queued','running') LIMIT 1").get())break;
    const previous=Date.parse(stateGet(`listening_clusters_refreshed_v2:${owner.id}`,''));
    if(!Number.isFinite(previous)||Date.now()-previous>6*3600_000)await refreshListeningClusters(owner.id);
  }
}
const research=setInterval(()=>{if(!maintaining&&(playlistRefreshMode()==='enabled'||playlistRefreshMode()==='canary')){
  maintaining=true;void listenerMaintenance().then(()=>runDiscoveryMaintenance()).then(()=>{seedMetadataReviews();return runMetadataReviews()}).catch(error=>console.error(String(error))).finally(()=>{maintaining=false});
}},15*60_000);
process.once('SIGTERM',()=>{stopping=true;clearInterval(timer);clearInterval(research)});
process.once('SIGINT',()=>{stopping=true;clearInterval(timer);clearInterval(research)});
console.log(JSON.stringify({event:'worker_start',component:'playlist_refresh',at:new Date().toISOString()}));
async function main(){while(!stopping){
  try{if(await runNextRefreshJob())continue}
  catch(error){console.error(JSON.stringify({event:'playlist_refresh_worker_error',error:String(error)}))}
  await new Promise(resolve=>setTimeout(resolve,2_000));
}}
void main().catch(error=>{console.error(String(error));process.exitCode=1});
