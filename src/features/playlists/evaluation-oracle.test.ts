import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTrackEvidence} from './track-evidence';
import {scenarioViolations,independentEligibleCount} from './evaluation-oracle';
import type {EvidencedCandidate} from './selection-policy';
function track(id:number,profile:Record<string,unknown>,artist='Artist'):EvidencedCandidate{
  const title='Song '+id,album='Album',evidence=buildTrackEvidence({artist,title,profile,tags:{}});
  return{fileId:id,title,artist,album,year:0,profile,evidence,songId:String(id),listener:{id:String(id),title,artist,album,playCount:0,hasPlayed:false,lastPlayed:null,favourite:true,rating:null,providerIds:{}},exposureCount:0,removedAt:null,score:0,reason:'',origin:'catalog'};
}
test('independent checks accept piano variants and reject vocals even if a compiled intent were weakened',()=>{
  const piano=track(1,{genre:['jazz'],instrumentation:['electric_piano'],vocalProfile:['instrumental']});
  assert.deepEqual(scenarioViolations('depth-piano',[piano]),[]);
  const sung=track(2,{genre:['jazz'],instrumentation:['piano'],vocalProfile:['clean_sung']});
  assert.ok(scenarioViolations('depth-piano',[sung]).includes('Required consistent instrumental evidence'));
  assert.deepEqual(scenarioViolations('chat-keep-order',[track(3,{genre:['Trip-Hop'],style:['downtempo']})]),[]);
});
test('single-artist sufficiency uses the largest eligible group instead of summing unrelated favourites',()=>{
  const pool=Array.from({length:10},(_,i)=>track(i+1,{},i<4?'One':'Two'));
  assert.equal(independentEligibleCount('rediscovery-small',pool),6);
  assert.ok(scenarioViolations('rediscovery-small',pool).includes('Only one artist requested'));
});
test('German correction retains only compatible instrumental position locks and permits quiet live music',()=>{
  const quietLive=track(1,{recordingTypes:['live_recording'],energy:'low',vocalProfile:['instrumental']}),sung=track(2,{vocalProfile:['clean_sung']});
  assert.deepEqual(scenarioViolations('chat-german',[quietLive]),[]);
  assert.deepEqual(scenarioViolations('chat-german',[quietLive],{stage:'correction',previous:[quietLive,sung]}),[]);
  assert.ok(scenarioViolations('chat-german',[{...quietLive,fileId:3,evidence:{...quietLive.evidence,recordingKey:'other'}}],{stage:'correction',previous:[quietLive]}).includes('Requested first-two position lock lost'));
});
test('a named available opener is checked independently without corrupting the eligible-pool denominator',()=>{
  const basket=track(1,{genre:['rock'],style:['punk_rock']},'Green Day'),other=track(2,{genre:['rock'],style:['punk_rock']},'Green Day');basket.title='Basket Case';basket.evidence.originalYear=1994;other.evidence.originalYear=1994;
  const options={stage:'correction' as const,available:[basket,other]};
  assert.ok(scenarioViolations('chat-artist-decade',[other,basket],options).includes('Requested Basket Case opener was available but not first'));
  assert.deepEqual(scenarioViolations('chat-artist-decade',[basket,other],options),[]);
  assert.equal(independentEligibleCount('chat-artist-decade',[basket,other],options),2);
});
