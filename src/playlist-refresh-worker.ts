import {pollPlaylistRefreshSchedule,runNextRefreshJob} from '@/features/playlists/refresh-worker';

let stopping=false;
const tick=()=>{try{pollPlaylistRefreshSchedule()}catch(error){console.error(JSON.stringify({event:'playlist_refresh_schedule_error',error:String(error)}))}};
tick();const timer=setInterval(tick,60_000);
process.once('SIGTERM',()=>{stopping=true;clearInterval(timer)});
process.once('SIGINT',()=>{stopping=true;clearInterval(timer)});
console.log(JSON.stringify({event:'worker_start',component:'playlist_refresh',at:new Date().toISOString()}));
while(!stopping){
  try{if(await runNextRefreshJob())continue}
  catch(error){console.error(JSON.stringify({event:'playlist_refresh_worker_error',error:String(error)}))}
  await new Promise(resolve=>setTimeout(resolve,2_000));
}
