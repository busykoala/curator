import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTrackEvidence} from './track-evidence';
import {withRecordingGroups,selectionRecordingKey} from './recording-groups';
import type {EvidencedCandidate} from './selection-policy';
const first='12345678-1234-1234-1234-123456789abc',second='12345678-1234-1234-1234-123456789abd';
function track(fileId:number,recordingId?:string,version='studio'):EvidencedCandidate{
  const evidence=buildTrackEvidence({artist:'Artist',title:'Song',tags:{},profile:{recordingTypes:[version]},external:recordingId?[{field:'recordingId',value:recordingId,scope:'recording',url:'https://musicbrainz.org/recording/'+recordingId}]:[]});
  return{fileId,artist:'Artist',title:'Song',album:'Album '+fileId,evidence} as EvidencedCandidate;
}
test('verified and unverified physical copies share a selection group without manufacturing verified metadata',()=>{
  const unknown=track(1),identified=track(2,first),grouped=withRecordingGroups([unknown,identified]);
  assert.equal(selectionRecordingKey(grouped[0]),selectionRecordingKey(grouped[1]));assert.equal(grouped[0].evidence.recordingKey,unknown.evidence.recordingKey);assert.equal(grouped[0].evidence.fields.recordingId,undefined);
  const live=withRecordingGroups([unknown,identified,track(3,undefined,'live')]);assert.notEqual(selectionRecordingKey(live[0]),selectionRecordingKey(live[2]));
});
test('distinct verified recordings survive and an ambiguous unverified copy is withheld',()=>{
  const grouped=withRecordingGroups([track(1),track(2,first),track(3,second)]);
  assert.deepEqual(grouped.map(track=>track.fileId),[2,3]);assert.notEqual(selectionRecordingKey(grouped[0]),selectionRecordingKey(grouped[1]));
});
