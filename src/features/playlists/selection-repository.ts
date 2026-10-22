import {selectionRecordingKey,withRecordingGroups} from './recording-groups';
import {createHash} from 'node:crypto';
import {db,stateGet,stateSet} from '@/features/db/client';
import {identityName as norm,trackAlbumMatches,trackArtistMatches,trackPositionMatches,nativePathMatches} from '@/features/integrations/navidrome-identity';
import {playlistTrackEvidence} from './evidence-repository';
import {listenerMusicSnapshot,type ListenerSnapshot,type ListenerSong} from './listening-snapshot';
import {discoveryTrackBoosts} from './discovery-lifecycle';
import {assessCandidate,type EvidencedCandidate,type PlaylistEvaluation} from './selection-policy';
import {compilePlaylistIntent,type ChatIntentContext} from './intent-compiler';
import {selectPlaylist} from './selection-policy';
import type {PlaylistDefinition,PlaylistCandidate} from './types';
import {chatState} from './chat-state';
import {choosePlaylistAdditions} from './selection-agent';
import {retrievePlaylistCandidates,type RetrievalProvider} from './retrieval';
import {aiClient,aiModel,type CuratorAiClient} from '@/features/ai/client';
import {recordAiUsage} from '@/features/ai/usage';
import {playlistAttemptRecorder} from './inference-metrics';
import {resolveIntentTrackRequests} from './intent-track-requests';
import {ownerRecordingExposure,rememberExposureFallback,exposureIdentityKeys} from './exposure-history';
import {fallbackRecordingKey} from './track-evidence';
import {discoveryDirection} from './discovery-directions';

type CatalogRow={id:number;path:string;artist_name:string;album_name:string;tags_json:string;profile_json:string;jellyfin_song_id:string|null;identity_hash:string|null};
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
  return ownerRecordingExposure(ownerId);
}
export function loadEvidencedCandidates(definition:PlaylistDefinition,snapshot:ListenerSnapshot){
  ensurePlaylistExposureHistory(definition.ownerUserId);
  const songsById=new Map(snapshot.songs.map(song=>[song.id,song])),songsByTitle=new Map<string,ListenerSong[]>();
  const artistPlays=new Map<string,number>();
  const albumPlays=new Map<string,string>();
  for(const song of snapshot.songs){const key=norm(song.title);songsByTitle.set(key,[...(songsByTitle.get(key)??[]),song])}
  for(const song of snapshot.songs){
    artistPlays.set(norm(song.artist),(artistPlays.get(norm(song.artist))??0)+song.playCount+(song.favourite?1:0));
    const key=norm(song.artist)+'|'+norm(song.album),played=albumPlays.get(key);
    if(song.lastPlayed&&(!played||Date.parse(song.lastPlayed)>Date.parse(played)))albumPlays.set(key,song.lastPlayed);
  }
  const rows=db().prepare(`SELECT f.id,f.path,f.artist_name,f.album_name,f.tags_json,p.profile_json,m.jellyfin_song_id,m.identity_hash
    FROM files f JOIN track_profiles p ON p.file_id=f.id LEFT JOIN navidrome_track_map m ON m.file_id=f.id
    WHERE f.status='written' AND p.status='complete'`).all() as CatalogRow[];
  const exposure=playlistExposure(definition.ownerUserId),boosts=discoveryTrackBoosts(definition.id,definition.ownerUserId);
  const recommendations=db().prepare(`SELECT r.id,r.genres_json,d.origin FROM playlist_discovery_recommendations d JOIN playlist_discovery_releases r ON r.id=d.release_id
    WHERE d.playlist_id=? AND d.owner_user_id=? AND d.status='ready' AND d.boost_until>CURRENT_TIMESTAMP`).all(definition.id,definition.ownerUserId) as Array<{id:string;genres_json:string;origin:string}>;
  const pool:EvidencedCandidate[]=[],mappings:Array<{fileId:number;hash:string;songId:string}>=[];
  for(const row of rows){
    const tags=JSON.parse(row.tags_json),title=list(tags.title)[0]??'';
    if(!title)continue;
    const matches=(song:ListenerSong)=>norm(song.title)===norm(title)&&trackArtistMatches(song.artists?.length?song.artists:[song.artist],row.artist_name,tags.artist)&&trackAlbumMatches(song.album,row.album_name,tags.album);
    const cached=row.identity_hash===identityHash(title,row.artist_name,row.album_name)&&row.jellyfin_song_id?songsById.get(row.jellyfin_song_id):undefined;
    const exact=(songsByTitle.get(norm(title))??[]).filter(matches);
    // A native identity must be visible to this owner. A name collision is
    // ambiguous and cannot be fixed by selecting the first matching file.
    const paths=exact.filter(song=>nativePathMatches(row.path,song.path));
    const positions=exact.filter(song=>trackPositionMatches(tags,song.trackNumber,song.discNumber));
    const song=paths.length===1?paths[0]:cached&&matches(cached)&&(!cached.path||nativePathMatches(row.path,cached.path))?cached:
      exact.length===1&&!exact[0].path?exact[0]:positions.length===1&&!positions[0].path?positions[0]:undefined;
    if(!song)continue;
    if(!cached||cached.id!==song.id)mappings.push({fileId:row.id,hash:identityHash(title,row.artist_name,row.album_name),songId:song.id});
    const evidence=playlistTrackEvidence(row.id);if(!evidence)continue;
    const history=exposure(row.id,row.artist_name,title,evidence);
    const groupId=Object.entries(tags).find(([key])=>key.toLowerCase().replace(/[^a-z]/g,'')==='musicbrainzreleasegroupid')?.[1];
    const releaseId=list(groupId)[0],boost=boosts.get(releaseId),recommendation=recommendations.find(rec=>rec.id===releaseId);
    pool.push({fileId:row.id,title,artist:row.artist_name,album:row.album_name,year:evidence.originalYear??0,
      profile:{...Object.fromEntries(Object.entries(evidence.fields).map(([key,field])=>[key,field.value])),bpmUncertain:evidence.fields.bpm?.confidence==='low'||evidence.fields.bpm?.source==='audio'},evidence,
      songId:song.id,listener:song,exposureCount:history?.exposure_count??0,removedAt:history?.removed_at??null,
      artistPlayCount:artistPlays.get(norm(song.artist))??0,
      score:0,reason:'',origin:boost?'discovery':'catalog',discoveryBoost:boost?.boost??0,
      // The research adapter explicitly records adjacent mode; a genre mismatch
      // or a model's guess is never sufficient adjacent-style evidence.
      adjacent:recommendation?.origin.endsWith('-adjacent'),albumLastPlayed:albumPlays.get(norm(song.artist)+'|'+norm(song.album))??null,
    });
  }
  const nativeGroups=new Map<string,EvidencedCandidate[]>();for(const track of pool)nativeGroups.set(track.songId,[...(nativeGroups.get(track.songId)??[]),track]);
  const ambiguous=new Set([...nativeGroups].filter(([,tracks])=>new Set(tracks.map(track=>selectionRecordingKey(track))).size>1).map(([id])=>id));
  const safe=pool.filter(track=>!ambiguous.has(track.songId)),safeIds=new Set(safe.map(track=>track.fileId));
  db().transaction(()=>{
    const insert=db().prepare(`INSERT INTO navidrome_track_map(file_id,song_id,identity_hash,jellyfin_song_id) VALUES(?,'',?,?)
      ON CONFLICT(file_id) DO UPDATE SET song_id=CASE WHEN identity_hash=excluded.identity_hash THEN song_id ELSE '' END,
      identity_hash=excluded.identity_hash,jellyfin_song_id=excluded.jellyfin_song_id,verified_at=CURRENT_TIMESTAMP`);
    for(const mapping of mappings)if(safeIds.has(mapping.fileId))insert.run(mapping.fileId,mapping.hash,mapping.songId);
  })();
  return withRecordingGroups(safe);
}

export async function generateIntentSelection(definition:PlaylistDefinition,options:{client?:Pick<CuratorAiClient,'structured'>;provider?:RetrievalProvider;signal?:AbortSignal;snapshot?:ListenerSnapshot;chat?:ChatIntentContext;interactive?:boolean}={}){
  const started=Date.now(),deadline=AbortSignal.timeout(240_000),signal=options.signal?AbortSignal.any([options.signal,deadline]):deadline;
  const snapshot=options.snapshot??await listenerMusicSnapshot(definition.ownerUserId);
  if(!snapshot.available||/must sign in|\b401\b/i.test(snapshot.error))throw Error(snapshot.error||'A complete listening snapshot is not available yet');
  const pool=loadEvidencedCandidates(definition,snapshot);
  const priorIds=previousSelectionIds(definition.id),chat=definition.category==='chat'?(options.chat??chatState(definition.id)).result:null;
  const currentIds=options.interactive?chat?.items.map(track=>track.fileId)??[]:priorIds.length?priorIds:chat?.items.map(track=>track.fileId)??[];
  const current=currentIds.flatMap(id=>{const track=pool.find(item=>item.fileId===id);return track?[track]:[]});
  signal.throwIfAborted();
  const vocabulary=Object.fromEntries(['genre','style','mood','listeningContexts','scenes','instrumentation','dynamicCharacter','structuralCharacter'].map(field=>{
    const counts=new Map<string,number>();for(const track of pool){const item=track.evidence.fields[field];if(item&&!['unknown','conflict'].includes(item.source))for(const value of list(item.value))counts.set(value,(counts.get(value)??0)+1)}
    return[field,[...counts].sort((a,b)=>b[1]-a[1]).slice(0,field==='style'?160:60).map(([value])=>value)];
  }));
  const compiled=await compilePlaylistIntent(definition,current,{client:options.client,signal,chat:options.chat,interactive:options.interactive,vocabulary});
  if(definition.category==='discovery')for(const track of pool)Object.assign(track,discoveryDirection(track,compiled.intent));
  const selectionDefinition=options.interactive&&compiled.detail.replaceUnpinned?{...definition,config:{...definition.config,rotationPercent:100}}:definition;
  const feedback=db().prepare(`SELECT file_id,artist,action FROM playlist_feedback WHERE owner_user_id=? AND (playlist_id=? OR playlist_id IS NULL)
    AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)`).all(definition.ownerUserId,definition.id) as Array<{file_id:number;artist:string;action:string}>;
  const excluded=new Set(feedback.filter(row=>row.action==='exclude'||row.action==='snooze').map(row=>row.file_id));
  const excludedKeys=new Set(pool.filter(track=>excluded.has(track.fileId)).map(track=>selectionRecordingKey(track)));
  // These fields are application-owned, rebuilt from current owner feedback.
  // Never freeze an expired snooze into the saved conversational intent.
  compiled.intent.excludedFileIds=[...excluded];compiled.intent.excludedRecordings=[...excludedKeys];
  compiled.intent.hard.excludeArtists.push(...feedback.filter(row=>row.action==='artist_exclude').map(row=>row.artist));
  for(const pin of feedback.filter(row=>row.action==='pin')){const track=pool.find(t=>t.fileId===pin.file_id);if(track)compiled.intent.pinnedRecordings.push({fileId:track.fileId,recordingKey:selectionRecordingKey(track)})}
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
  const available=pool.filter(track=>!excludedKeys.has(selectionRecordingKey(track)));
  const trackRequests=resolveIntentTrackRequests(compiled.intent,selectionDefinition,available,current,snapshot);
  db().prepare("UPDATE playlist_intents SET intent_json=? WHERE playlist_id=? AND json_extract(intent_json,'$.sourceRevision')=?").run(JSON.stringify(compiled.intent),definition.id,compiled.intent.sourceRevision);
  let selected=selectPlaylist({definition:selectionDefinition,intent:compiled.intent,pool:available,previous:current,snapshot});
  const previousKeys=new Set(current.map(track=>selectionRecordingKey(track)));
  const lockedIds=new Set([...compiled.intent.pinnedRecordings.map(pin=>pin.fileId),...compiled.intent.positionLocks.map(lock=>lock.fileId)]);
  const fixed=selected.items.filter(track=>track.retained||lockedIds.has(track.fileId));
  const proposed=selected.items.filter(track=>!fixed.some(kept=>kept.fileId===track.fileId));
  const aiDetails:Array<Record<string,unknown>>=[];
  let retrievalDetail:Record<string,unknown>|null=null;
  if(!selected.evaluation.shortage&&!selected.evaluation.violations.length&&proposed.length){
    const fixedKeys=new Set(fixed.map(track=>selectionRecordingKey(track))),canonical=new Map<string,EvidencedCandidate>();
    const allowedArtists=compiled.intent.hard.singleArtist?new Set(selected.items.map(track=>norm(track.artist))):null;
    for(const track of available){
      if(allowedArtists&&!allowedArtists.has(norm(track.artist)))continue;
      if(previousKeys.has(selectionRecordingKey(track))||fixedKeys.has(selectionRecordingKey(track))||track.removedAt&&Date.now()-track.removedAt<14*86400_000)continue;
      const assessment=assessCandidate(track,definition,compiled.intent,snapshot);
      if(assessment.eligible&&!canonical.has(selectionRecordingKey(track)))canonical.set(selectionRecordingKey(track),{...track,score:assessment.score,reason:assessment.reasons.join(' · ')});
    }
    const retrieved=await retrievePlaylistCandidates(compiled.intent.summary+'\n'+[...compiled.intent.soft.styles,...compiled.intent.soft.moods,...compiled.intent.soft.contexts].join(', '),[...canonical.values()],{provider:options.provider,signal,mandatoryIds:proposed.map(track=>track.fileId)});
    retrievalDetail=retrieved.detail;
    const chosen:EvidencedCandidate[]=[],repairBudget={remaining:1},chunks=Math.ceil(proposed.length/60);
    for(let chunk=0;chunk<chunks;chunk++){
      signal.throwIfAborted();
      const required=proposed.slice(chunk*60,chunk*60+60),requiredIds=new Set(required.map(track=>track.fileId)),used=new Set(chosen.map(track=>track.fileId));
      const candidates=[...required,...retrieved.candidates.filter(track=>!requiredIds.has(track.fileId)&&!used.has(track.fileId))].slice(0,60);
      const result=await choosePlaylistAdditions({client:options.client??aiClient,intent:compiled.intent,candidates,target:required.length,
        feasibleIds:required.map(track=>track.fileId),
        adjacentTarget:definition.category==='discovery'?required.filter(track=>track.adjacent).length:undefined,
        listenerContext:{complete:snapshot.complete,stale:snapshot.stale,capturedAt:snapshot.capturedAt,observedSongs:snapshot.songs.length},
        retainedArtists:[...new Set([...fixed,...chosen].map(track=>track.artist))],signal,
        priority:options.interactive?'interactive':'background',
        limits:{maxPerArtist:selected.evaluation.diversityLimits?.artist??definition.config.maxTracksPerArtist,
          maxPerAlbum:selected.evaluation.diversityLimits?.album??definition.config.maxTracksPerAlbum,
          retained:[...fixed,...chosen].map(track=>({artist:track.artist,album:track.album}))},
        maxToolTurns:Math.floor(6/chunks),maxToolCalls:Math.floor(12/chunks),repairBudget,onAttempt:playlistAttemptRecorder(definition,'selection'),
      });
      recordAiUsage('playlist_selection',aiModel,result.detail);aiDetails.push(result.detail);chosen.push(...result.items);
    }
    const final=selectPlaylist({definition:selectionDefinition,intent:compiled.intent,pool:[...fixed,...chosen],previous:current,snapshot});
    final.evaluation.eligible=selected.evaluation.eligible;
    final.evaluation.relaxations=[...new Set([...selected.evaluation.relaxations,...final.evaluation.relaxations])];
    if(final.evaluation.shortage||final.evaluation.violations.length)throw Error('AI selection failed final count, constraint or ordering validation; retained the previous mix');
    selected=final;
    const reasons=new Map(chosen.map(track=>[track.fileId,track.reason]));for(const item of selected.items)if(reasons.has(item.fileId))item.reason=reasons.get(item.fileId)!;
  }
  signal.throwIfAborted();
  return{...selected,intent:compiled.intent,detail:{selectionVersion:1,evaluation:selected.evaluation,intent:compiled.detail,trackRequests,retrieval:retrievalDetail,ai:aiDetails,listener:{complete:snapshot.complete,stale:snapshot.stale,capturedAt:snapshot.capturedAt,error:snapshot.error},latencyMs:Date.now()-started}};
}

// Called in the local publication transaction only after native verification.
// UNIQUE(run_id,file_id) makes crash-recovery confirmation idempotent.
export function recordPlaylistExposure(definition:PlaylistDefinition,runId:number,items:PlaylistCandidate[],now=Date.now()){
  const current=items.flatMap(item=>{const evidence=playlistTrackEvidence(item.fileId);return evidence?[{item,evidence,key:evidence.recordingKey,fallback:fallbackRecordingKey(item.artist,item.title,evidence.fields)}]:[]});
  const keys=new Set(current.flatMap(row=>exposureIdentityKeys(row.item.fileId,row.key,row.fallback)));
  // Hydrate legacy verified IDs before a future file deletion can remove the
  // only available artist/title/version association.
  ownerRecordingExposure(definition.ownerUserId,now);
  const active=db().prepare('SELECT run_id,file_id,recording_key,fallback_key FROM playlist_recording_exposure WHERE owner_user_id=? AND playlist_id=? AND removed_at IS NULL').all(definition.ownerUserId,definition.id) as Array<{run_id:number;file_id:number;recording_key:string;fallback_key:string}>;
  for(const row of active)if(!exposureIdentityKeys(row.file_id,row.recording_key,row.fallback_key).some(key=>keys.has(key))){
    db().prepare('UPDATE playlist_recording_exposure SET removed_at=? WHERE run_id=? AND file_id=?').run(now,row.run_id,row.file_id);
    db().prepare('UPDATE playlist_exposure SET removed_at=? WHERE run_id=? AND file_id=?').run(now,row.run_id,row.file_id);
  }
  const insert=db().prepare('INSERT OR IGNORE INTO playlist_exposure(owner_user_id,playlist_id,run_id,file_id,recording_key,exposed_at) VALUES(?,?,?,?,?,?)');
  for(const row of current){insert.run(definition.ownerUserId,definition.id,runId,row.item.fileId,row.key,now);rememberExposureFallback(runId,row.item.fileId,row.item.artist,row.item.title,row.evidence)}
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
