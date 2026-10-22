import type {PlaylistDefinition,PlaylistCandidate} from './types';
import type {PlaylistIntent} from './intent-schema';
import type {ListenerSnapshot} from './listening-snapshot';
import {assessCandidate,type EvidencedCandidate} from './selection-policy';
import {identityName as normal} from '@/features/integrations/navidrome-identity';
export function assertIntentPublication(definition:PlaylistDefinition,intent:PlaylistIntent,items:Pick<PlaylistCandidate,'fileId'|'artist'>[],pool:EvidencedCandidate[],snapshot:Pick<ListenerSnapshot,'complete'|'stale'>){
  if(items.length!==definition.config.targetTracks)throw Error('Selection size no longer matches the requested song count; kept the previous mix');
  const byId=new Map(pool.map(track=>[track.fileId,track])),recordings=new Set<string>(),nativeIds=new Set<string>();
  for(const item of items){
    const track=byId.get(item.fileId);
    if(!track||!assessCandidate(track,definition,intent,snapshot).eligible)throw Error('Track evidence or availability changed; kept the previous mix');
    if(recordings.has(track.evidence.recordingKey)||nativeIds.has(track.songId))throw Error('Selection contains duplicate recordings or native identities');
    recordings.add(track.evidence.recordingKey);nativeIds.add(track.songId);
  }
  if(intent.hard.singleArtist&&new Set(items.map(track=>normal(track.artist))).size>1)throw Error('Only one artist was requested; kept the previous mix');
  for(const pin of intent.pinnedRecordings){
    const track=byId.get(pin.fileId);
    if(track&&assessCandidate(track,definition,intent,snapshot).eligible&&!items.some(item=>item.fileId===pin.fileId||byId.get(item.fileId)?.evidence.recordingKey===track.evidence.recordingKey))throw Error('A valid pinned recording is missing; kept the previous mix');
  }
  for(const lock of intent.positionLocks){
    const track=byId.get(lock.fileId);
    if(track&&assessCandidate(track,definition,intent,snapshot).eligible&&items[lock.position]?.fileId!==lock.fileId)throw Error('A valid position lock changed; kept the previous mix');
  }
}
