import {createHash} from 'node:crypto';
import {db,stateGet,stateSet} from '@/features/db/client';
import {identityName as norm,trackAlbumMatches,trackArtistMatches} from '@/features/integrations/navidrome-identity';
import {playlistTrackEvidence} from './evidence-repository';
import {listenerMusicSnapshot,type ListenerSnapshot,type ListenerSong} from './listening-snapshot';
import {discoveryTrackBoosts} from './discovery-lifecycle';
import {assessCandidate,type EvidencedCandidate,type PlaylistEvaluation} from './selection-policy';
import {compilePlaylistIntent} from './intent-compiler';
import {selectPlaylist} from './selection-policy';
import type {PlaylistDefinition,PlaylistCandidate} from './types';
import {chatState} from './chat-state';
import {choosePlaylistAdditions} from './selection-agent';
import {retrievePlaylistCandidates,type RetrievalProvider} from './retrieval';
import {aiClient,aiModel,type CuratorAiClient} from '@/features/ai/client';
import {recordAiUsage} from '@/features/ai/usage';
import {playlistAttemptRecorder} from './inference-metrics';

type CatalogRow={id:number;artist_name:string;album_name:string;tags_json:string;profile_json:string;jellyfin_song_id:string|null;identity_hash:string|null};
const list=(value:unknown)=>Array.isArray(value)?value.map(String):value==null?[]:[String(value)];
const identityHash=(title:string,artist:string,album:string)=>createHash('sha256').update(`${title}|${artist}|${album}`).digest('hex');
const epoch=(value:string)=>Date.parse(value.includes('T')?value:value.replace(' ','T')+'Z');

export function ensurePlaylistExposureHistory(ownerId:number){
  const key=`playlist_exposure_backfilled:${ownerId}`;if(stateGet(key)==='true')return;
  db().transaction(()=>{
    if(stateGet(key)==='true')return;
    const runs=db().prepare(`SELECT id,playlist_id,finished_at FROM playlist_runs WHERE owner_user_id=? AND preview=0 AND status='complete'
      AND (finished_at>=datetime('now','-14 days') OR id IN(SELECT max(id) FROM playlist_runs WHERE owner_user_id=? AND status='complete' AND preview=0 GROUP BY playlist_id))
      ORDER BY id`).all(ownerId,ownerId) as Array<{id:number;playlist_id:number;finished_at:string}>;
    const active=new Map<number,Set<string>>();
    for(const run of runs){
      const rows=db().prepare('SELECT file_id FROM playlist_items WHERE run_id=?').all(run.id) as Array<{file_id:number}>;
      const stamp=epoch(run.finished_at),keys=new Set<string>();if(!Number.isFinite(stamp))continue;
      for(const row of rows){
        const evidence=playlistTrackEvidence(row.file_id);if(!evidence)continue;keys.add(evidence.recordingKey);
        db().prepare('INSERT OR IGNORE INTO playlist_exposure(owner_user_id,playlist_id,run_id,file_id,recording_key,exposed_at) VALUES(?,?,?,?,?,?)').run(ownerId,run.playlist_id,run.id,row.file_id,evidence.recordingKey,stamp);
      }
      for(const removed of active.get(run.playlist_id)??[])if(!keys.has(removed))db().prepare('UPDATE playlist_exposure SET removed_at=? WHERE owner_user_id=? AND playlist_id=? AND recording_key=? AND removed_at IS NULL AND exposed_at<?').run(stamp,ownerId,run.playlist_id,removed,stamp);
      active.set(run.playlist_id,keys);
    }
    stateSet(key,'true');
  })();
}

export function previousSelectionIds(playlistId:number){
  return(db().prepare("SELECT file_id FROM playlist_items WHERE run_id=(SELECT id FROM playlist_runs WHERE playlist_id=? AND status='complete' AND preview=0 ORDER BY id DESC LIMIT 1) ORDER BY position").all(playlistId) as Array<{file_id:number}>).map(row=>row.file_id);
}
export function playlistExposure(ownerId:number){
  const rows=db().prepare(`SELECT recording_key,sum(exposed_at>=?) exposure_count,max(removed_at) removed_at
    FROM playlist_exposure WHERE owner_user_id=? GROUP BY recording_key`).all(Date.now()-7*86400_000,ownerId) as Array<{recording_key:string;exposure_count:number;removed_at:number|null}>;
  return new Map(rows.map(row=>[row.recording_key,row]));
}
export function loadEvidencedCandidates(definition:PlaylistDefinition,snapshot:ListenerSnapshot){
  ensurePlaylistExposureHistory(definition.ownerUserId);
  const songsById=new Map(snapshot.songs.map(song=>[song.id,song])),songsByTitle=new Map<string,ListenerSong[]>();
  for(const song of snapshot.songs){const key=norm(song.title);songsByTitle.set(key,[...(songsByTitle.get(key)??[]),song])}
  const rows=db().prepare(`SELECT f.id,f.artist_name,f.album_name,f.tags_json,p.profile_json,m.jellyfin_song_id,m.identity_hash
    FROM files f JOIN track_profiles p ON p.file_id=f.id LEFT JOIN navidrome_track_map m ON m.file_id=f.id
    WHERE f.status='written' AND p.status='complete'`).all() as CatalogRow[];
  const exposure=playlistExposure(definition.ownerUserId),boosts=discoveryTrackBoosts(definition.id,definition.ownerUserId);
  const recommendations=db().prepare(`SELECT r.id,r.genres_json,d.origin FROM playlist_discovery_recommendations d JOIN playlist_discovery_releases r ON r.id=d.release_id
    WHERE d.playlist_id=? AND d.owner_user_id=? AND d.status='ready' AND d.boost_until>CURRENT_TIMESTAMP`).all(definition.id,definition.ownerUserId) as Array<{id:string;genres_json:string;origin:string}>;
  const pool:EvidencedCandidate[]=[],mappings:Array<{fileId:number;hash:string;songId:string}>=[];
  for(const row of rows){
    const tags=JSON.parse(row.tags_json),title=list(tags.title)[0]??'';
    if(!title)continue;
    const matches=(song:ListenerSong)=>norm(song.title)===norm(title)&&trackArtistMatches([song.artist],row.artist_name,tags.artist)&&trackAlbumMatches(song.album,row.album_name,tags.album);
    const cached=row.identity_hash===identityHash(title,row.artist_name,row.album_name)&&row.jellyfin_song_id?songsById.get(row.jellyfin_song_id):undefined;
    const exact=(songsByTitle.get(norm(title))??[]).filter(matches);
    // A native identity must be visible to this owner. A name collision is
    // ambiguous and cannot be fixed by selecting the first matching file.
    const song=cached&&matches(cached)?cached:exact.length===1?exact[0]:undefined;
    if(!song)continue;
    if(!cached||cached.id!==song.id)mappings.push({fileId:row.id,hash:identityHash(title,row.artist_name,row.album_name),songId:song.id});
    const evidence=playlistTrackEvidence(row.id);if(!evidence)continue;
    const history=exposure.get(evidence.recordingKey);
    const groupId=Object.entries(tags).find(([key])=>key.toLowerCase().replace(/[^a-z]/g,'')==='musicbrainzreleasegroupid')?.[1];
    const releaseId=list(groupId)[0],boost=boosts.get(releaseId),recommendation=recommendations.find(rec=>rec.id===releaseId);
    pool.push({fileId:row.id,title,artist:row.artist_name,album:row.album_name,year:evidence.originalYear??0,
      profile:Object.fromEntries(Object.entries(evidence.fields).map(([key,field])=>[key,field.value])),evidence,
      songId:song.id,listener:song,exposureCount:history?.exposure_count??0,removedAt:history?.removed_at??null,
      score:0,reason:'',origin:boost?'discovery':'catalog',discoveryBoost:boost?.boost??0,
      // The research adapter explicitly records adjacent mode; a genre mismatch
      // or a model's guess is never sufficient adjacent-style evidence.
      adjacent:recommendation?.origin==='listenbrainz-adjacent',
    });
  }
  db().transaction(()=>{
    const insert=db().prepare(`INSERT INTO navidrome_track_map(file_id,song_id,identity_hash,jellyfin_song_id) VALUES(?,'',?,?)
      ON CONFLICT(file_id) DO UPDATE SET song_id=CASE WHEN identity_hash=excluded.identity_hash THEN song_id ELSE '' END,
      identity_hash=excluded.identity_hash,jellyfin_song_id=excluded.jellyfin_song_id,verified_at=CURRENT_TIMESTAMP`);
    for(const mapping of mappings)insert.run(mapping.fileId,mapping.hash,mapping.songId);
  })();
  return pool;
}

export async function generateIntentSelection(definition:PlaylistDefinition,options:{client?:Pick<CuratorAiClient,'structured'>;provider?:RetrievalProvider;signal?:AbortSignal}={}){
  const started=Date.now(),deadline=AbortSignal.timeout(240_000),signal=options.signal?AbortSignal.any([options.signal,deadline]):deadline;
  const snapshot=await listenerMusicSnapshot(definition.ownerUserId);
  if(!snapshot.available||/must sign in|\b401\b/i.test(snapshot.error))throw Error(snapshot.error||'A complete listening snapshot is not available yet');
  const pool=loadEvidencedCandidates(definition,snapshot);
  const priorIds=previousSelectionIds(definition.id),chat=definition.category==='chat'?chatState(definition.id).result:null;
  const currentIds=priorIds.length?priorIds:chat?.items.map(track=>track.fileId)??[];
  const current=currentIds.flatMap(id=>{const track=pool.find(item=>item.fileId===id);return track?[track]:[]});
  signal.throwIfAborted();
  const compiled=await compilePlaylistIntent(definition,current,{client:options.client,signal});
  const feedback=db().prepare(`SELECT file_id,artist,action FROM playlist_feedback WHERE owner_user_id=? AND (playlist_id=? OR playlist_id IS NULL)
    AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)`).all(definition.ownerUserId,definition.id) as Array<{file_id:number;artist:string;action:string}>;
  const excluded=new Set(feedback.filter(row=>row.action==='exclude'||row.action==='snooze').map(row=>row.file_id));
  const excludedKeys=new Set(pool.filter(track=>excluded.has(track.fileId)).map(track=>track.evidence.recordingKey));
  compiled.intent.hard.excludeArtists.push(...feedback.filter(row=>row.action==='artist_exclude').map(row=>row.artist));
  for(const pin of feedback.filter(row=>row.action==='pin')){const track=pool.find(t=>t.fileId===pin.file_id);if(track)compiled.intent.pinnedRecordings.push({fileId:track.fileId,recordingKey:track.evidence.recordingKey})}
  // One representative per researched release receives the temporary boost,
  // chosen by track-level fit before the boost, rather than filesystem order.
  const groups=new Map<string,EvidencedCandidate[]>();
  for(const track of pool.filter(track=>track.discoveryBoost)){
    const key=norm(track.artist)+'|'+norm(track.album);groups.set(key,[...(groups.get(key)??[]),track]);
  }
  for(const tracks of groups.values()){
    const representative=[...tracks].filter(track=>assessCandidate(track,definition,compiled.intent,snapshot).eligible).sort((a,b)=>assessCandidate({...b,discoveryBoost:0},definition,compiled.intent,snapshot).score-assessCandidate({...a,discoveryBoost:0},definition,compiled.intent,snapshot).score)[0];
    for(const track of tracks)if(track!==representative){track.discoveryBoost=0;track.origin='catalog'}
  }
  const available=pool.filter(track=>!excludedKeys.has(track.evidence.recordingKey));
  let selected=selectPlaylist({definition,intent:compiled.intent,pool:available,previous:current,snapshot});
  const previousKeys=new Set(current.map(track=>track.evidence.recordingKey));
  const lockedIds=new Set([...compiled.intent.pinnedRecordings.map(pin=>pin.fileId),...compiled.intent.positionLocks.map(lock=>lock.fileId)]);
  const fixed=selected.items.filter(track=>track.retained||lockedIds.has(track.fileId));
  const proposed=selected.items.filter(track=>!fixed.some(kept=>kept.fileId===track.fileId));
  const aiDetails:Array<Record<string,unknown>>=[];
  let retrievalDetail:Record<string,unknown>|null=null;
  if(!selected.evaluation.shortage&&!selected.evaluation.violations.length&&proposed.length){
    const fixedKeys=new Set(fixed.map(track=>track.evidence.recordingKey)),canonical=new Map<string,EvidencedCandidate>();
    for(const track of available){
      if(previousKeys.has(track.evidence.recordingKey)||fixedKeys.has(track.evidence.recordingKey)||track.removedAt&&Date.now()-track.removedAt<14*86400_000)continue;
      const assessment=assessCandidate(track,definition,compiled.intent,snapshot);
      if(assessment.eligible&&!canonical.has(track.evidence.recordingKey))canonical.set(track.evidence.recordingKey,{...track,score:assessment.score,reason:assessment.reasons.join(' · ')});
    }
    const retrieved=await retrievePlaylistCandidates(compiled.intent.summary+'\n'+JSON.stringify(compiled.intent.soft),[...canonical.values()],{provider:options.provider,signal,mandatoryIds:proposed.map(track=>track.fileId)});
    retrievalDetail=retrieved.detail;
    const chosen:EvidencedCandidate[]=[],repairBudget={remaining:1},chunks=Math.ceil(proposed.length/60);
    for(let chunk=0;chunk<chunks;chunk++){
      signal.throwIfAborted();
      const required=proposed.slice(chunk*60,chunk*60+60),requiredIds=new Set(required.map(track=>track.fileId)),used=new Set(chosen.map(track=>track.fileId));
      const candidates=[...required,...retrieved.candidates.filter(track=>!requiredIds.has(track.fileId)&&!used.has(track.fileId))].slice(0,60);
      const result=await choosePlaylistAdditions({client:options.client??aiClient,intent:compiled.intent,candidates,target:required.length,
        adjacentTarget:definition.category==='discovery'?required.filter(track=>track.adjacent).length:undefined,
        listenerContext:{complete:snapshot.complete,stale:snapshot.stale,capturedAt:snapshot.capturedAt,observedSongs:snapshot.songs.length},
        retainedArtists:[...new Set([...fixed,...chosen].map(track=>track.artist))],signal,
        maxToolTurns:Math.floor(6/chunks),maxToolCalls:Math.floor(12/chunks),repairBudget,onAttempt:playlistAttemptRecorder(definition,'selection'),
      });
      recordAiUsage('playlist_selection',aiModel,result.detail);aiDetails.push(result.detail);chosen.push(...result.items);
    }
    const final=selectPlaylist({definition,intent:compiled.intent,pool:[...fixed,...chosen],previous:current,snapshot});
    final.evaluation.eligible=selected.evaluation.eligible;
    final.evaluation.relaxations=[...new Set([...selected.evaluation.relaxations,...final.evaluation.relaxations])];
    if(final.evaluation.shortage||final.evaluation.violations.length)throw Error('AI selection failed final count, constraint or ordering validation; retained the previous mix');
    selected=final;
    const reasons=new Map(chosen.map(track=>[track.fileId,track.reason]));for(const item of selected.items)if(reasons.has(item.fileId))item.reason=reasons.get(item.fileId)!;
  }
  signal.throwIfAborted();
  return{...selected,intent:compiled.intent,detail:{selectionVersion:1,evaluation:selected.evaluation,intent:compiled.detail,retrieval:retrievalDetail,ai:aiDetails,listener:{complete:snapshot.complete,stale:snapshot.stale,capturedAt:snapshot.capturedAt,error:snapshot.error},latencyMs:Date.now()-started}};
}

// Called in the local publication transaction only after native verification.
// UNIQUE(run_id,file_id) makes crash-recovery confirmation idempotent.
export function recordPlaylistExposure(definition:PlaylistDefinition,runId:number,items:PlaylistCandidate[],now=Date.now()){
  const current=items.flatMap(item=>{const evidence=playlistTrackEvidence(item.fileId);return evidence?[{item,key:evidence.recordingKey}]:[]});
  const keys=new Set(current.map(row=>row.key));
  const active=db().prepare('SELECT DISTINCT recording_key FROM playlist_exposure WHERE owner_user_id=? AND playlist_id=? AND removed_at IS NULL').all(definition.ownerUserId,definition.id) as Array<{recording_key:string}>;
  for(const row of active)if(!keys.has(row.recording_key))db().prepare('UPDATE playlist_exposure SET removed_at=? WHERE owner_user_id=? AND playlist_id=? AND recording_key=? AND removed_at IS NULL').run(now,definition.ownerUserId,definition.id,row.recording_key);
  const insert=db().prepare('INSERT OR IGNORE INTO playlist_exposure(owner_user_id,playlist_id,run_id,file_id,recording_key,exposed_at) VALUES(?,?,?,?,?,?)');
  for(const row of current)insert.run(definition.ownerUserId,definition.id,runId,row.item.fileId,row.key,now);
  const releases=db().prepare("SELECT d.id,r.id release_id FROM playlist_discovery_recommendations d JOIN playlist_discovery_releases r ON r.id=d.release_id WHERE d.playlist_id=? AND d.owner_user_id=? AND d.status='ready'").all(definition.id,definition.ownerUserId) as Array<{id:number;release_id:string}>;
  for(const rec of releases){
    const presented=items.some(item=>{const row=db().prepare('SELECT tags_json FROM files WHERE id=?').get(item.fileId) as {tags_json:string};const tags=JSON.parse(row.tags_json);return Object.entries(tags).some(([key,value])=>key.toLowerCase().replace(/[^a-z]/g,'')==='musicbrainzreleasegroupid'&&list(value).includes(rec.release_id))});
    if(presented)db().prepare("UPDATE playlist_discovery_recommendations SET status='presented',presented_at=coalesce(presented_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?").run(rec.id);
  }
}

export function previewEvaluation(runId:number):PlaylistEvaluation|null{
  const row=db().prepare('SELECT detail_json FROM playlist_runs WHERE id=?').get(runId) as {detail_json:string}|undefined;
  return row?JSON.parse(row.detail_json).evaluation??null:null;
}
