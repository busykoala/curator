import type {EvidencedCandidate} from './selection-policy';
import {fallbackRecordingKey} from './track-evidence';
export const selectionRecordingKey=(track:EvidencedCandidate)=>track.recordingGroupKey??track.evidence.recordingKey;
// A grouping key prevents two physical copies from being selected together.
// It never upgrades the unverified copy's recordingId or its field provenance.
export function withRecordingGroups(pool:EvidencedCandidate[]){
  const groups=new Map<string,Set<string>>();
  for(const track of pool){const key=fallbackRecordingKey(track.artist,track.title,track.evidence.fields);if(!groups.has(key))groups.set(key,new Set());if(track.evidence.recordingKey.startsWith('mb:'))groups.get(key)!.add(track.evidence.recordingKey)}
  return pool.flatMap(track=>{
    const ids=groups.get(fallbackRecordingKey(track.artist,track.title,track.evidence.fields))!;
    if(track.evidence.recordingKey.startsWith('mb:'))return[{...track,recordingGroupKey:track.evidence.recordingKey}];
    // The same title/version has multiple independently identified recordings:
    // do not guess which recording an unverified physical copy contains.
    if(ids.size>1)return[];
    return[{...track,recordingGroupKey:ids.size===1?[...ids][0]:track.evidence.recordingKey}];
  });
}
