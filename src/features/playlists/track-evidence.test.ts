import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTrackEvidence} from './track-evidence';
import {canonicalSemanticField,canonicalSemanticValue} from '@/features/categorization/vocabulary';
test('canonical fields and values agree across metadata, tools and scoring',()=>{
  assert.equal(canonicalSemanticField('instruments'),'instrumentation');
  assert.equal(canonicalSemanticField('BPM'),'bpm');assert.equal(canonicalSemanticField('VOCALPROFILE'),'vocalProfile');
  assert.equal(canonicalSemanticValue('instruments','electric guitars'),'electric_guitar');
  assert.equal(canonicalSemanticValue('genre','Hip-Hop'),'hip_hop');
  assert.equal(canonicalSemanticValue('genre','Trip-Hop'),'electronic');assert.equal(canonicalSemanticValue('style','Trip-Hop'),'trip_hop');
});
test('model-generated tags do not corroborate their own inference',()=>{
  const result=buildTrackEvidence({artist:'A',title:'T',profile:{instrumentation:['piano'],vocalProfile:['instrumental']},tags:{instrumentation:['piano'],vocalProfile:['instrumental']},provenance:{model:'curator'}});
  assert.equal(result.fields.instrumentation.source,'model_inference');assert.equal(result.fields.instrumentation.confidence,'low');
});
test('a specific embedded genre is preserved when the generated profile uses its broader parent genre',()=>{
  const specific=buildTrackEvidence({artist:'Artist',title:'Song',tags:{genre:['Trip-Hop']},profile:{genre:['electronic'],style:['downtempo','chillout']},provenance:{model:'curator'}});
  assert.equal(specific.fields.genre.source,'embedded');assert.deepEqual(specific.fields.genre.value,['Trip-Hop']);
  const copied=buildTrackEvidence({artist:'Artist',title:'Song',tags:{genre:['Trip-Hop']},profile:{genre:['trip_hop']},provenance:{model:'curator'}});
  assert.equal(copied.fields.genre.source,'model_inference');
});
test('user overrides survive conflicting inference and independent facts remain separate',()=>{
  const result=buildTrackEvidence({artist:'A',title:'T',profile:{instruments:['piano']},tags:{},manual:{instrumentation:['guitar']},external:[{field:'instruments',value:['piano'],url:'https://example.com/credits',scope:'recording'}]});
  assert.equal(result.fields.instrumentation.source,'user_override');assert.deepEqual(result.fields.instrumentation.value,['guitar']);
});
test('conflicting vocal or factual evidence becomes unknown instead of being silently overwritten',()=>{
  const result=buildTrackEvidence({artist:'A',title:'T',profile:{vocalProfile:['instrumental','spoken'],instrumentation:['piano']},tags:{instrumentation:['guitar']},external:[{field:'instrumentation',value:['piano'],scope:'recording',url:'https://example.com/credits'}]});
  assert.equal(result.fields.vocalProfile.source,'conflict');assert.equal(result.fields.instrumentation.source,'conflict');
  assert.equal(result.fields.vocalProfile.value,null);
});
test('numeric audio features do not claim vocal detection or categorical musical intensity',()=>{
  const result=buildTrackEvidence({artist:'A',title:'T',profile:{energy:'low'},tags:{},audio:{estimatedBpm:120,beatRegularity:.9,energy:1,rmsDb:-5}});
  assert.equal(result.fields.bpm.source,'audio');assert.equal(result.fields.energy.source,'model_inference');assert.equal(result.fields.vocalProfile,undefined);
});
test('original dates and distinct recording versions survive modern reissues',()=>{
  const base={artist:'東京',title:'Song',profile:{recordingTypes:['studio_recording']},tags:{date:['2020-01-01'],originaldate:['1977-01-01']}};
  const studio=buildTrackEvidence(base),live=buildTrackEvidence({...base,profile:{recordingTypes:['live_recording']}});
  assert.equal(studio.originalYear,1977);assert.equal(studio.editionYear,2020);assert.notEqual(studio.recordingKey,live.recordingKey);
  const id='a74b1b7f-71a5-4011-9441-d0b5e4122711';
  const first=buildTrackEvidence({...base,tags:{musicbrainz_recordingid:[id]}}),reissue=buildTrackEvidence({...base,tags:{musicbrainz_recordingid:[id],date:['2025']}});
  assert.equal(first.recordingKey,reissue.recordingKey);
  assert.equal(first.fields.recordingId.confidence,'medium');
  const verified=buildTrackEvidence({...base,external:[{field:'recordingId',value:id,scope:'recording',url:'https://musicbrainz.org/recording/'+id}]});
  assert.equal(verified.recordingKey,'mb:'+id);assert.equal(verified.fields.recordingId.confidence,'high');
});
test('empty semantic fields are unknown and empty embedded tags cannot erase positive evidence',()=>{
  const result=buildTrackEvidence({artist:'A',title:'T',profile:{vocalProfile:[],instrumentation:['piano']},tags:{instrumentation:[]}});
  assert.equal(result.fields.vocalProfile.source,'unknown');assert.equal(result.fields.vocalProfile.value,null);
  assert.equal(result.fields.instrumentation.source,'model_inference');assert.deepEqual(result.fields.instrumentation.value,['piano']);
});
test('conflicting original dates are reviewable and explicit year overrides are preserved',()=>{
  const input={artist:'A',title:'T',profile:{},tags:{date:['2020']},external:[{field:'originalDate',value:'1977',scope:'recording' as const,url:'https://example.com/one'},{field:'originalDate',value:'1981',scope:'recording' as const,url:'https://example.com/two'}]};
  const conflict=buildTrackEvidence(input);assert.equal(conflict.originalYear,null);assert.equal(conflict.fields.originalYear.source,'conflict');
  const override=buildTrackEvidence({...input,manual:{originalYear:1977}});assert.equal(override.originalYear,1977);assert.equal(override.fields.originalYear.source,'user_override');
});
