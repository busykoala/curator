import {stat} from 'node:fs/promises';
import {db} from '@/features/db/client';
import {addMusic,lidarrQueue,searchMusic} from '@/features/integrations/music';
import {unresolvedNavidromeCandidates} from '@/features/integrations/navidrome';
import {qbitTorrents,type Torrent} from '@/features/acquisition/qbittorrent';
import {targetByAlbum} from '@/features/acquisition/repository';
import type {PlaylistCandidate} from './types';
import {activeDiscoveryRecommendations,reserveDiscoveryAdmission,type DiscoveryRecommendation} from './discovery-repository';
import {playlistRefreshMode,refreshManaged} from './refresh-jobs';
import {claimMaintenanceLease,heartbeatMaintenanceLease,assertMaintenanceLease,releaseMaintenanceLease} from './maintenance-lease';
import {getPlaylist} from './repository';
import {compilePlaylistIntent} from './intent-compiler';
import {discoveryResearchDirection,recommendationRelease} from './discovery-direction-state';
import {discoveryReleaseFit} from './discovery-fit';

function timestamp(value:string|null){return value?Date.parse(value.endsWith('Z')?value:value.replace(' ','T')+'Z'):0}
export function discoveryProgressDecision(row:DiscoveryRecommendation,sizeLeft:number|null,targetProgress:string|null,now=Date.now()){
  const progressed=sizeLeft!==null&&row.last_size_left!==null&&sizeLeft<row.last_size_left||timestamp(targetProgress)>timestamp(row.last_progress_at);
  const last=progressed?now:timestamp(row.last_progress_at)||timestamp(row.queued_at);
  return {progressed,defer:last>0&&now-last>=48*3600_000,lastProgressAt:last?new Date(last).toISOString():null};
}
async function readyTracks(row:DiscoveryRecommendation){
  const rows=db().prepare(`SELECT f.id,f.path,f.artist_name,f.album_name,f.tags_json,p.profile_json FROM files f
    JOIN track_profiles p ON p.file_id=f.id AND p.status='complete' LEFT JOIN manual_overrides m ON m.album_key=f.album_key AND m.confirmed=1
    WHERE f.status='written' AND (m.release_group_mbid=? OR EXISTS (SELECT 1 FROM json_each(f.tags_json) tag
    WHERE lower(tag.key) IN ('musicbrainz_releasegroupid','musicbrainzreleasegroupid','release_group_mbid')
    AND (tag.value=? OR EXISTS(SELECT 1 FROM json_each(CASE WHEN tag.type='array' THEN tag.value ELSE '[]' END) WHERE value=?))))`)
    .all(row.release_id,row.release_id,row.release_id) as Array<{id:number;path:string;artist_name:string;album_name:string;tags_json:string;profile_json:string}>;
  const candidates:PlaylistCandidate[]=[];
  for(const file of rows){
    if(!(await stat(file.path).catch(()=>null))?.size)continue;
    const tags=JSON.parse(file.tags_json),title=Array.isArray(tags.title)?tags.title[0]:tags.title;
    candidates.push({fileId:file.id,title:title??'',artist:file.artist_name,album:file.album_name,profile:JSON.parse(file.profile_json),year:0,score:0,origin:'discovery',reason:'Verified researched release'});
  }
  const unresolved=new Set((await unresolvedNavidromeCandidates(candidates,row.owner_user_id)).map(t=>t.fileId));
  return candidates.filter(t=>!unresolved.has(t.fileId)).map(t=>t.fileId);
}
const defaults={queue:lidarrQueue,torrents:qbitTorrents,target:targetByAlbum,add:addMusic,ready:readyTracks,lookup:searchMusic};
export function genuinelyActiveDiscoveryTorrent(torrent:Pick<Torrent,'progress'|'state'|'dlspeed'|'added_on'>,lastProgress:number,now=Date.now()){
  if(torrent.progress>=1||/paused|stopped|error|missing|upload|stalledup|queuedup|checkingup/i.test(torrent.state))return false;
  if(!/^(downloading|forceddl|metadl|forcedmetadl|checkingdl|allocating|moving|checkingresumedata|queueddl|stalleddl)$/i.test(torrent.state))return false;
  if(torrent.dlspeed>0)return true;
  const last=Math.max(lastProgress||0,Number(torrent.added_on||0)*1000);
  // Recent commitments still count while resolving metadata/starting. Old
  // non-progressing transfers do not permanently occupy every discovery slot.
  return !last||now-last<48*3600_000;
}
function activeDiscoveryHashes(rows:DiscoveryRecommendation[],torrents:Awaited<ReturnType<typeof qbitTorrents>>,target:typeof targetByAlbum,now=Date.now()){
  // Ready, dismissed, deferred and disabled recommendations may still have a
  // real transfer. Their bytes count toward the global active cap too.
  const known=db().prepare("SELECT download_hash,last_progress_at,created_at FROM acquisition_targets WHERE origin='playlist' AND download_hash IS NOT NULL").all() as Array<{download_hash:string;last_progress_at:string|null;created_at:string}>;
  const progress=new Map<string,number>();
  for(const item of known)progress.set(item.download_hash.toLowerCase(),Math.max(progress.get(item.download_hash.toLowerCase())??0,timestamp(item.last_progress_at)||timestamp(item.created_at)));
  for(const row of rows){const item=row.lidarr_album_id?target(row.lidarr_album_id):undefined;if(item?.download_hash){const hash=item.download_hash.toLowerCase();progress.set(hash,Math.max(progress.get(hash)??0,timestamp(row.last_progress_at)||timestamp(row.queued_at),timestamp(item.last_progress_at)))}}
  return new Set(torrents.filter(t=>progress.has(t.hash.toLowerCase())&&genuinelyActiveDiscoveryTorrent(t,progress.get(t.hash.toLowerCase())!,now)).map(t=>t.hash.toLowerCase()));
}
export async function reconcileDiscoveryAdmissions(dependencies=defaults){
  const reservations=db().prepare(`SELECT a.id,a.release_id,a.playlist_id,r.artist_id FROM playlist_discovery_admissions a JOIN playlist_discovery_releases r ON r.id=a.release_id
    WHERE a.status='reserved' AND a.created_at<=datetime('now','-15 minutes') ORDER BY a.created_at LIMIT 6`).all() as Array<{id:string;release_id:string;playlist_id:number;artist_id:string}>;
  let resolved=0;
  for(const reservation of reservations){
    const result=await dependencies.lookup(`lidarr:${reservation.release_id}`) as {albums?:Array<{id?:number;foreignAlbumId?:string;artist?:{foreignArtistId?:string}}>};
    const exact=(result.albums??[]).filter(a=>a.foreignAlbumId===reservation.release_id&&a.artist?.foreignArtistId===reservation.artist_id);
    if(exact.length!==1)continue;
    const id=Number(exact[0].id??0);
    db().transaction(()=>{
      if(id>0){
        db().prepare('UPDATE playlist_discovery_releases SET lidarr_album_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id,reservation.release_id);
        db().prepare("UPDATE playlist_discovery_recommendations SET status='queued',queued_at=coalesce(queued_at,CURRENT_TIMESTAMP),last_progress_at=coalesce(last_progress_at,CURRENT_TIMESTAMP),message='Recovered acquisition receipt',updated_at=CURRENT_TIMESTAMP WHERE playlist_id=? AND release_id=? AND status IN ('researched','deferred')").run(reservation.playlist_id,reservation.release_id);
      }
      db().prepare("UPDATE playlist_discovery_admissions SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id>0?'admitted':'not_admitted',reservation.id);
    })();resolved++;
  }
  return resolved;
}
export async function refreshDiscoveryLifecycle(dependencies=defaults,now=new Date()){
  const rows=activeDiscoveryRecommendations();if(!rows.length)return{active:0,imported:0,deferred:0};
  // A service outage cannot masquerade as an absent transfer or authorize a
  // new admission. Preserve state and surface the dependency failure.
  const [queue,torrents]=await Promise.all([dependencies.queue(),dependencies.torrents()]);
  let imported=0,deferred=0;
  for(const row of rows){
    const ready=await dependencies.ready(row);
    if(ready.length){
      db().prepare("UPDATE playlist_discovery_recommendations SET status='ready',ready_at=coalesce(ready_at,CURRENT_TIMESTAMP),boost_until=coalesce(boost_until,datetime('now','+14 days')),message='Verified playable tracks available',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
      imported++;continue;
    }
    if(!['queued','downloading'].includes(row.status))continue;
    const native=queue.filter(item=>item.albumId===row.lidarr_album_id);
    const target=row.lidarr_album_id?dependencies.target(row.lidarr_album_id):undefined;
    const left=native.length?native.reduce((sum,item)=>sum+Number(item.sizeleft??0),0):null;
    const progress=discoveryProgressDecision(row,left,target?.last_progress_at??null,now.getTime());
    db().prepare(`UPDATE playlist_discovery_recommendations SET status=?,last_size_left=?,last_progress_at=?,cooldown_until=?,message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(progress.defer?'deferred':target?.status==='downloading'?'downloading':'queued',left??row.last_size_left,progress.lastProgressAt,
        progress.defer?new Date(now.getTime()+7*86400_000).toISOString():null,
        progress.defer?'No acquisition progress for 48 hours; considering other recommendations. Existing data retained.':'Acquisition managed independently by Curator',row.id);
    if(progress.defer)deferred++;
  }
  const discoveryHashes=activeDiscoveryHashes(rows,torrents,dependencies.target,now.getTime());
  return{active:discoveryHashes.size,imported,deferred};
}

export async function queueDiscoveryRecommendations(dependencies=defaults,now=new Date()){
  const name='discovery-acquisition',token=claimMaintenanceLease(name);if(!token)return{admitted:0,active:0,busy:true};
  const heartbeat=setInterval(()=>{try{heartbeatMaintenanceLease(name,token)}catch(error){console.warn(JSON.stringify({event:'discovery_admission_heartbeat_failed',error:String(error)}))}},15_000);
  try{return await queueDiscoveryRecommendationsLocked(dependencies,now,()=>assertMaintenanceLease(name,token))}
  finally{clearInterval(heartbeat);releaseMaintenanceLease(name,token)}
}
async function queueDiscoveryRecommendationsLocked(dependencies:typeof defaults,now:Date,assertLease:()=>void){
  await reconcileDiscoveryAdmissions(dependencies);
  const [queue,torrents]=await Promise.all([dependencies.queue(),dependencies.torrents()]);
  const rows=activeDiscoveryRecommendations();
  let active=activeDiscoveryHashes(rows,torrents,dependencies.target,now.getTime()).size,admitted=0;
  const directions=new Map<string,Awaited<ReturnType<typeof compilePlaylistIntent>>|null>();
  for(const row of rows.filter(r=>['researched','deferred'].includes(r.status))){
    assertLease();
    if(playlistRefreshMode()==='canary'&&!refreshManaged(row.playlist_id))continue;
    if(row.cooldown_until&&timestamp(row.cooldown_until)>now.getTime())continue;
    if((await dependencies.ready(row)).length)continue;
    const existing=row.lidarr_album_id?dependencies.target(row.lidarr_album_id):undefined;
    if(existing&&['pending','staged','queued','downloading','downloaded'].includes(existing.status)){
      db().prepare("UPDATE playlist_discovery_recommendations SET status='queued',queued_at=coalesce(queued_at,CURRENT_TIMESTAMP),last_progress_at=coalesce(last_progress_at,CURRENT_TIMESTAMP),message='Reusing existing acquisition',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);continue;
    }
    // The shared release may already be in the native queue even if its
    // acquisition target has not yet been synchronized.
    if(row.lidarr_album_id&&queue.some(item=>item.albumId===row.lidarr_album_id))continue;
    const playlist=getPlaylist(row.playlist_id);
    if(!playlist||!playlist.enabled||playlist.ownerUserId!==row.owner_user_id||!(playlist.category==='discovery'||playlist.category==='depth'&&playlist.config.externalDiscovery))continue;
    const directionKey=playlist.id+':'+playlist.revision;
    if(!directions.has(directionKey))try{directions.set(directionKey,await compilePlaylistIntent(playlist,[]))}catch(error){directions.set(directionKey,null);db().prepare('UPDATE playlist_discovery_recommendations SET message=? WHERE id=?').run('Direction needs review: '+String(error).slice(0,200),row.id)}
    const compiled=directions.get(directionKey);if(!compiled||!discoveryReleaseFit(discoveryResearchDirection(playlist,compiled.intent),recommendationRelease(row),compiled.intent))continue;
    db().prepare('UPDATE playlist_discovery_recommendations SET direction_revision=? WHERE id=? AND EXISTS(SELECT 1 FROM smart_playlists p WHERE p.id=playlist_id AND p.revision=?)').run(playlist.revision??1,row.id,playlist.revision??1);
    assertLease();const reservation=reserveDiscoveryAdmission(row,active,now,playlist.revision??1);if(!reservation)continue;
    try{
      const added=await dependencies.add(row.artist_id,[row.release_id],'playlist');
      assertLease();
      const albumId=added.albumIds[0];if(!albumId)throw Error('Acquisition returned no album identity');
      db().transaction(()=>{
        db().prepare("UPDATE playlist_discovery_releases SET lidarr_album_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(albumId,row.release_id);
        db().prepare("UPDATE playlist_discovery_recommendations SET status='queued',queued_at=CURRENT_TIMESTAMP,last_progress_at=CURRENT_TIMESTAMP,cooldown_until=NULL,message='Queued verified discovery',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
        db().prepare("UPDATE playlist_discovery_admissions SET status='admitted',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(reservation);
      })();admitted++;active++;
    }catch(error){
      // An ambiguous admission may have reached Lidarr. Keep the reservation
      // counted until a later successful lookup resolves it; never fan out
      // duplicate album submissions after a lost response.
      db().prepare("UPDATE playlist_discovery_recommendations SET message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(`Admission needs reconciliation: ${String(error)}`,row.id);
    }
  }
  return{admitted,active};
}

export function discoveryTrackBoosts(playlistId:number,ownerId:number){
  const releases=db().prepare("SELECT r.id,r.artist,r.album FROM playlist_discovery_recommendations d JOIN playlist_discovery_releases r ON r.id=d.release_id JOIN smart_playlists p ON p.id=d.playlist_id AND p.owner_user_id=d.owner_user_id WHERE d.playlist_id=? AND d.owner_user_id=? AND d.direction_revision=p.revision AND d.status='ready' AND d.boost_until>CURRENT_TIMESTAMP").all(playlistId,ownerId) as Array<{id:string;artist:string;album:string}>;
  return new Map(releases.map(r=>[r.id,{artist:r.artist,album:r.album,boost:12}]));
}
