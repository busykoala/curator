import test from 'node:test';
import assert from 'node:assert/strict';
import {configuredIntent} from './intent-schema';
import {resolveIntentTrackRequests} from './intent-track-requests';
import {assertIntentPublication} from './selection-validation';
import {selectPlaylist,type EvidencedCandidate} from './selection-policy';
import {buildTrackEvidence} from './track-evidence';
import {defaultConfig,type PlaylistDefinition} from './types';
const definition={id:1,ownerUserId:1,category:'chat',intent:'Rock',config:{...defaultConfig('chat'),targetTracks:2}} as PlaylistDefinition,snapshot={complete:true,stale:false};
function track(id:number,title:string):EvidencedCandidate{
  const artist='Green Day',album='Album',profile={genre:['rock'],style:['punk_rock'],vocalProfile:['clean_sung']};
  return{fileId:id,title,artist,album,year:1994,profile,evidence:buildTrackEvidence({artist,title,profile,tags:{originaldate:'1994'}}),songId:'native-'+id,listener:null,exposureCount:0,removedAt:null,score:1,reason:'',origin:'catalog'};
}
const existing=track(1,'Existing'),basket=track(2,'Basket Case'),copy=track(3,'Basket Case');
const request={title:'Basket Case',artist:'Green Day',action:'include' as const,position:0,required:false,quote:'Put Basket Case first if available'};
test('named songs outside the current selection resolve to eligible native library identities and retain their requested position',()=>{
  const intent=configuredIntent(definition,'revision');intent.trackRequests=[request];
  const detail=resolveIntentTrackRequests(intent,definition,[existing,basket,copy],[existing],snapshot);
  assert.deepEqual(detail.unavailable,[]);assert.equal(detail.resolved[0].fileId,basket.fileId);
  const selected=selectPlaylist({definition,intent,pool:[existing,basket,copy],previous:[existing],snapshot});
  assert.equal(selected.items[0].fileId,basket.fileId);assert.equal(selected.items.length,2);assert.deepEqual(selected.evaluation.violations,[]);
  assert.doesNotThrow(()=>assertIntentPublication(definition,intent,selected.items,[existing,basket,copy],snapshot));
});
test('named requests never bypass new vocal exclusions and distinguish conditional absence from a required song',()=>{
  const intent=configuredIntent(definition,'revision');intent.trackRequests=[request];intent.hard.vocal='instrumental';
  const result=resolveIntentTrackRequests(intent,definition,[basket],[],snapshot);assert.equal(result.unavailable.length,1);assert.equal(intent.pinnedRecordings.length,0);
  intent.trackRequests[0]={...request,required:true};assert.throws(()=>resolveIntentTrackRequests(intent,definition,[basket],[],snapshot),/not available under the saved requirements/);
});
test('an explicitly pinned physical copy takes precedence over a previously selected duplicate',()=>{
  const intent=configuredIntent(definition,'revision');intent.pinnedRecordings=[{fileId:basket.fileId,recordingKey:basket.evidence.recordingKey}];intent.positionLocks=[{fileId:basket.fileId,position:0}];
  const selected=selectPlaylist({definition,intent,pool:[existing,copy,basket],previous:[copy],snapshot});
  assert.equal(selected.items[0].fileId,basket.fileId);assert.ok(!selected.items.some(track=>track.fileId===copy.fileId));
});
test('publication rechecks exact counts, recording uniqueness, pins, positions and current evidence',()=>{
  const intent=configuredIntent(definition,'revision');intent.pinnedRecordings=[{fileId:2,recordingKey:basket.evidence.recordingKey}];intent.positionLocks=[{fileId:2,position:0}];
  assert.throws(()=>assertIntentPublication(definition,intent,[existing],[existing,basket],snapshot),/song count/);
  assert.throws(()=>assertIntentPublication(definition,intent,[basket,copy],[existing,basket,copy],snapshot),/duplicate recording/);
  assert.throws(()=>assertIntentPublication(definition,intent,[existing,basket],[existing,basket],snapshot),/position lock/);
  const missingPin=track(4,'Other');assert.throws(()=>assertIntentPublication(definition,intent,[existing,missingPin],[existing,basket,missingPin],snapshot),/pinned recording/);
  intent.hard.vocal='instrumental';assert.throws(()=>assertIntentPublication(definition,intent,[basket,existing],[existing,basket],snapshot),/evidence or availability changed/);
});
test('current feedback overrides an earlier pin without making publication require the excluded song',()=>{
  const intent=configuredIntent(definition,'revision'),other=track(4,'Other');intent.pinnedRecordings=[{fileId:basket.fileId,recordingKey:basket.evidence.recordingKey}];intent.positionLocks=[{fileId:basket.fileId,position:0}];
  intent.excludedFileIds=[basket.fileId];intent.excludedRecordings=[basket.evidence.recordingKey];
  const selected=selectPlaylist({definition,intent,pool:[existing,basket,other],previous:[basket],snapshot});
  assert.ok(!selected.items.some(track=>track.fileId===basket.fileId));assert.equal(selected.items.length,2);
  assert.doesNotThrow(()=>assertIntentPublication(definition,intent,selected.items,[existing,basket,other],snapshot));
});
