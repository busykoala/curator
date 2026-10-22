import {selectionRecordingKey} from './recording-groups';
import {identityName as normal} from '@/features/integrations/navidrome-identity';
import type {PlaylistIntent} from './intent-schema';
import type {PlaylistDefinition} from './types';
import {assessCandidate,type EvidencedCandidate} from './selection-policy';
import type {ListenerSnapshot} from './listening-snapshot';

export function resolveIntentTrackRequests(intent:PlaylistIntent,definition:PlaylistDefinition,pool:EvidencedCandidate[],current:EvidencedCandidate[],snapshot:Pick<ListenerSnapshot,'complete'|'stale'>){
  const prior=new Set(current.map(track=>track.fileId)),unavailable:string[]=[],resolved:Array<{title:string;artist:string;fileId:number;position:number}>=[];
  for(const request of intent.trackRequests.filter(request=>request.action==='include')){
    const matches=pool.filter(track=>normal(track.title)===normal(request.title)&&(!request.artist||normal(track.artist)===normal(request.artist))&&assessCandidate(track,definition,intent,snapshot).eligible);
    matches.sort((a,b)=>Number(prior.has(b.fileId))-Number(prior.has(a.fileId))||Number(b.evidence.recordingKey.startsWith('mb:'))-Number(a.evidence.recordingKey.startsWith('mb:'))||assessCandidate(b,definition,intent,snapshot).score-assessCandidate(a,definition,intent,snapshot).score||a.fileId-b.fileId);
    const track=matches[0];
    if(!track){const name=(request.artist?request.artist+' — ':'')+request.title;if(request.required)throw Error(`Requested song is not available under the saved requirements: ${name}. Kept the previous mix.`);unavailable.push(name);continue}
    if(!intent.pinnedRecordings.some(pin=>pin.fileId===track.fileId))intent.pinnedRecordings.push({fileId:track.fileId,recordingKey:selectionRecordingKey(track)});
    if(request.position>=0){
      if(request.position>=definition.config.targetTracks)throw Error('Requested song position exceeds the playlist size');
      if(resolved.some(prior=>prior.position===request.position&&prior.fileId!==track.fileId))throw Error('Two named songs were requested at the same position');
      intent.positionLocks=intent.positionLocks.filter(lock=>lock.position!==request.position&&lock.fileId!==track.fileId);
      intent.positionLocks.push({fileId:track.fileId,position:request.position});
    }
    resolved.push({title:track.title,artist:track.artist,fileId:track.fileId,position:request.position});
  }
  return{resolved,unavailable};
}
