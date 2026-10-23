import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTrackEvidence} from './track-evidence';
import {scenarioViolations,independentEligibleCount,scenarioRetentionLocks} from './evaluation-oracle';
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
test('sufficiency counts verified duplicate copies as one recording',()=>{
  const one=track(1,{genre:['rock']}),copy={...track(2,{genre:['rock']}),recordingGroupKey:one.evidence.recordingKey};
  assert.equal(independentEligibleCount('depth-rock',[one,copy]),1);
});
test('the independent broad-electronic reference recognises explicit substyles across primary tags',()=>{
  for(const[genre,style]of [['hip_hop','trip_hop'],['ambient','downtempo'],['pop','synthpop'],['pop','trance'],['pop','electropop']]){
    assert.deepEqual(scenarioViolations('discovery-unicode',[track(1,{genre:[genre],style:[style],recordingTypes:['studio_recording']})]),[]);
  }
  for(const profile of [{genre:['ambient']},{genre:['rock'],instrumentation:['electric_guitar']},{genre:['rock'],style:['garage_rock']},{genre:['rock'],style:['industrial_rock']},{genre:['rnb_soul_funk'],style:['new_jack_swing']}])
    assert.ok(scenarioViolations('discovery-unicode',[track(1,profile)]).includes('Expected jazz or electronic direction'));
});
test('the independent Jazz reference accepts explicit Swing/Bebop styles but not compound names or groove',()=>{
  for(const style of ['swing','bebop','hard_bop','post_bop'])assert.deepEqual(scenarioViolations('mood-jazz',[track(1,{genre:['electronic'],style:[style]})]),[]);
  for(const profile of [{genre:['electronic'],style:['electro_swing']},{genre:['rnb_soul_funk'],style:['new_jack_swing']},{genre:['pop'],groove:['swing']}])assert.ok(scenarioViolations('mood-jazz',[track(1,profile)]).includes('Expected jazz direction or an agreed Discovery neighbour'));
});
test('independent album recency follows native compilation identity across artists and rejects undated plays',()=>{
  const now=Date.parse('2026-10-23T03:00:00Z'),candidate=track(1,{genre:['electronic']});
  Object.assign(candidate.listener!,{albumId:'compilation',albumArtist:'Various Artists',hasPlayed:true,playCount:4,lastPlayed:'2026-08-01T00:00:00Z'});
  const heard={...candidate.listener!,id:'another-song',artist:'Another Artist',lastPlayed:'2026-10-22T00:00:00Z'},snapshot={songs:[heard],complete:true,stale:false,capturedAt:'',error:'',available:true};
  assert.ok(scenarioViolations('rediscovery-genre',[candidate],{now,snapshot}).includes('Album was played recently or has undated plays'));
  assert.deepEqual(scenarioViolations('rediscovery-genre',[candidate],{now,snapshot:{...snapshot,songs:[{...heard,albumId:'different-native-album'}]}}),[]);
  assert.ok(scenarioViolations('rediscovery-genre',[candidate],{now,snapshot:{...snapshot,songs:[{...heard,lastPlayed:null}]}}).includes('Album was played recently or has undated plays'));
});
test('German correction retains only compatible instrumental position locks and permits quiet live music',()=>{
  const quietLive=track(1,{recordingTypes:['live_recording'],energy:'low',vocalProfile:['instrumental']}),sung=track(2,{vocalProfile:['clean_sung']});
  assert.deepEqual(scenarioViolations('chat-german',[quietLive]),[]);
  assert.deepEqual(scenarioViolations('chat-german',[quietLive],{stage:'correction',previous:[quietLive,sung]}),[]);
  assert.ok(scenarioViolations('chat-german',[{...quietLive,fileId:3,evidence:{...quietLive.evidence,recordingKey:'other'}}],{stage:'correction',previous:[quietLive]}).includes('Requested first-two position lock lost'));
});
test('conditional retention is bound to the original request, not replacements on later nights',()=>{
  const one=track(1,{vocalProfile:['instrumental']}),sung=track(2,{vocalProfile:['clean_sung']}),replacement=track(3,{vocalProfile:['instrumental']}),later=track(4,{vocalProfile:['instrumental']});
  const retentionReference=scenarioRetentionLocks('chat-german',[one,sung]);assert.deepEqual(retentionReference,[{position:0,recordingKey:one.evidence.recordingKey}]);
  assert.deepEqual(scenarioViolations('chat-german',[one,later],{stage:'nightly',previous:[one,replacement],retentionReference}),[]);
  assert.ok(scenarioViolations('chat-german',[later,replacement],{stage:'nightly',previous:[one,replacement],retentionReference}).includes('Requested first-two position lock lost'));
  assert.equal(scenarioRetentionLocks('chat-keep-order',[one,replacement]).length,2);
});
test('a named available opener is checked independently without corrupting the eligible-pool denominator',()=>{
  const basket=track(1,{genre:['rock'],style:['punk_rock']},'Green Day'),other=track(2,{genre:['rock'],style:['punk_rock']},'Green Day');basket.title='Basket Case';basket.evidence.originalYear=1994;other.evidence.originalYear=1994;
  const options={stage:'correction' as const,available:[basket,other]};
  assert.ok(scenarioViolations('chat-artist-decade',[other,basket],options).includes('Requested Basket Case opener was available but not first'));
  assert.deepEqual(scenarioViolations('chat-artist-decade',[basket,other],options),[]);
  assert.equal(independentEligibleCount('chat-artist-decade',[basket,other],options),2);
});
