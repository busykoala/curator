import {selectionRecordingKey} from './recording-groups';
import type {PlaylistDefinition,PlaylistCandidate} from './types';
import type {PlaylistIntent} from './intent-schema';
import type {ListenerSnapshot} from './listening-snapshot';
import {assessCandidate,type EvidencedCandidate} from './selection-policy';
import {identityName as normal} from '@/features/integrations/navidrome-identity';
import {StalePlaylistProposalError} from './proposal-errors';
export function assertIntentPublication(definition:PlaylistDefinition,intent:PlaylistIntent,items:Pick<PlaylistCandidate,'fileId'|'artist'>[],pool:EvidencedCandidate[],snapshot:Pick<ListenerSnapshot,'complete'|'stale'>){
  if(items.length!==definition.config.targetTracks)throw new StalePlaylistProposalError('Selection size no longer matches the requested song count; kept the previous mix');
  const byId=new Map(pool.map(track=>[track.fileId,track])),recordings=new Set<string>(),nativeIds=new Set<string>();
  for(const item of items){
    const track=byId.get(item.fileId);
    if(!track||!assessCandidate(track,definition,intent,snapshot).eligible)throw new StalePlaylistProposalError('Track evidence or availability changed; kept the previous mix');
    if(recordings.has(selectionRecordingKey(track))||nativeIds.has(track.songId))throw new StalePlaylistProposalError('Selection contains duplicate recordings or native identities');
    recordings.add(selectionRecordingKey(track));nativeIds.add(track.songId);
  }
  if(intent.hard.singleArtist&&new Set(items.map(track=>normal(track.artist))).size>1)throw new StalePlaylistProposalError('Only one artist was requested; kept the previous mix');
  for(const pin of intent.pinnedRecordings){
    const track=byId.get(pin.fileId);
    if(track&&assessCandidate(track,definition,intent,snapshot).eligible&&!items.some(item=>item.fileId===pin.fileId||(byId.has(item.fileId)?selectionRecordingKey(byId.get(item.fileId)!):null)===selectionRecordingKey(track)))throw new StalePlaylistProposalError('A valid pinned recording is missing; kept the previous mix');
  }
  for(const lock of intent.positionLocks){
    const track=byId.get(lock.fileId);
    if(track&&assessCandidate(track,definition,intent,snapshot).eligible&&items[lock.position]?.fileId!==lock.fileId)throw new StalePlaylistProposalError('A valid position lock changed; kept the previous mix');
  }
}
