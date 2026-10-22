import {pollPlaylistRefreshSchedule,runNextRefreshJob} from '@/features/playlists/refresh-worker';
import {runDiscoveryMaintenance} from '@/features/playlists/discovery-research';
import {playlistRefreshMode} from '@/features/playlists/refresh-jobs';
import {seedMetadataReviews,runMetadataReviews} from '@/features/playlists/metadata-review';

let stopping=false;
const tick=()=>{try{pollPlaylistRefreshSchedule()}catch(error){console.error(JSON.stringify({event:'playlist_refresh_schedule_error',error:String(error)}))}};
tick();const timer=setInterval(tick,60_000);
let maintaining=false;
const research=setInterval(()=>{if(!maintaining&&(playlistRefreshMode()==='enabled'||playlistRefreshMode()==='canary')){
  maintaining=true;void runDiscoveryMaintenance().then(()=>{seedMetadataReviews();return runMetadataReviews()}).catch(error=>console.error(String(error))).finally(()=>{maintaining=false});
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
