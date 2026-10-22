import test from 'node:test';import assert from 'node:assert/strict';
import {configuredIntent,canonicalIntent} from './intent-schema';import {defaultConfig,type PlaylistDefinition} from './types';
import {enforceSoftPreferences,enforceDiscoveryStylePreferences,groundFestivalExclusion} from './intent-preferences';
const base=()=>configuredIntent({config:defaultConfig('mood'),intent:''} as PlaylistDefinition,'revision');
test('ordinary mood/context preferences cannot become mandatory all-term filters',()=>{
  const intent=base();intent.hard.requirements=[{field:'genre',values:['trip_hop'],match:'all'},{field:'mood',values:['dark','atmospheric'],match:'all'},{field:'listeningContexts',values:['late_night'],match:'all'},{field:'mood',values:['aggressive'],match:'none'}];
  const changed=enforceSoftPreferences(intent,[],['Atmospheric, dark trip-hop for late night.']);
  assert.equal(changed.length,2);assert.deepEqual(intent.hard.requirements.map(rule=>rule.field),['genre','mood']);
  assert.deepEqual(canonicalIntent(intent).soft.moods,['dark','dreamy']);assert.deepEqual(intent.soft.contexts,['late_night']);
});
test('a literal mandatory user quote preserves only the requirements it actually supports',()=>{
  const intent=base();intent.hard.requirements=[{field:'mood',values:['dark','warm'],match:'all'}];
  enforceSoftPreferences(intent,[{field:'mood',quote:'Every song must be dark.'}],['Every song must be dark. Warm is optional.']);
  assert.deepEqual(intent.hard.requirements[0].values,['dark']);assert.deepEqual(intent.soft.moods,['warm']);
});
test('invented quotes and a mandatory instruction in a different sentence cannot harden a mood',()=>{
  for(const quote of ['Every song must be calm.','Every song must be instrumental. Keep it calm.']){
    const intent=base();intent.hard.requirements=[{field:'mood',values:['serene'],match:'all'}];
    enforceSoftPreferences(intent,[{field:'mood',quote}],['Every song must be instrumental. Keep it calm.']);
    assert.deepEqual(intent.hard.requirements,[]);assert.deepEqual(intent.soft.moods,['serene']);
  }
});
test('a speech exclusion uses vocal evidence without excluding instrumental musical interludes',()=>{
  const intent=base();intent.hard.requirements=[{field:'recordingTypes',values:['spoken_interlude','live_recording'],match:'none'}];
  const canonical=canonicalIntent(intent);
  assert.deepEqual(canonical.hard.requirements,[{field:'recordingTypes',values:['live_recording'],match:'none'},{field:'vocalProfile',values:['spoken'],match:'none'}]);
  const allInterludes=base();allInterludes.hard.requirements=[{field:'recordingTypes',values:['interlude'],match:'none'}];assert.deepEqual(canonicalIntent(allInterludes).hard.requirements,allInterludes.hard.requirements);
});
test('Discovery cannot harden an ordinary style centre and silently remove adjacent exploration',()=>{
  const intent=base();intent.hard.requirements=[{field:'style',values:['melodic_techno','ambient_techno'],match:'any'},{field:'style',values:['festival_edm'],match:'none'}];
  const changed=enforceDiscoveryStylePreferences(intent,['Melodic techno and ambient techno new to me. Hypnotic rather than festival EDM.'],[]);
  assert.equal(changed.length,1);assert.deepEqual(intent.soft.styles,['melodic_techno','ambient_techno']);
  assert.deepEqual(intent.hard.requirements,[{field:'style',values:['festival_edm'],match:'none'}]);
  const expanded=base();expanded.hard.requirements=[{field:'style',values:['melodic_techno'],match:'all'}];
  enforceDiscoveryStylePreferences(expanded,['Not only melodic techno; explore adjacent styles too.'],[]);
  assert.deepEqual(expanded.hard.requirements,[]);
});
test('Discovery preserves explicit exclusive directions and configured hard genre requirements',()=>{
  for(const direction of ['Only melodic techno, no adjacent styles.','Nur Melodic Techno.','Melodic techno is mandatory.']){
    const intent=base();intent.hard.requirements=[{field:'style',values:['melodic_techno'],match:'all'}];
    assert.equal(enforceDiscoveryStylePreferences(intent,[direction],[]).length,0);assert.equal(intent.hard.requirements.length,1);
  }
  const intent=base();intent.hard.requirements=[{field:'genre',values:['electronic'],match:'any'},{field:'style',values:['melodic_techno'],match:'all'}];
  enforceDiscoveryStylePreferences(intent,['Melodic techno new to me.'],[intent.hard.requirements[0]]);
  assert.deepEqual(intent.hard.requirements,[{field:'genre',values:['electronic'],match:'any'}]);
});
test('nightly interpretation cannot demote a saved explicit mood requirement',()=>{
  const intent=base();intent.hard.requirements=[{field:'mood',values:['dark'],match:'all'}];
  assert.deepEqual(enforceSoftPreferences(intent,[],['Every song must be dark.'],intent.hard.requirements),[]);
  assert.equal(intent.hard.requirements.length,1);
});
test('a qualified festival exclusion grounds bare model EDM in the actual direction and its canonical aliases',()=>{
  const intent=base();intent.hard.exclusions=['edm'];intent.hard.requirements=[{field:'style',values:['edm'],match:'none'}];
  assert.equal(groundFestivalExclusion(intent,['Hypnotic rather than festival EDM.'],base().hard),true);
  assert.deepEqual(intent.hard.exclusions,['festival_edm']);assert.deepEqual(intent.hard.requirements[0].values,['festival_edm']);
});
test('grounding never narrows a real general EDM exclusion',()=>{
  for(const configured of [false,true]){
    const intent=base();intent.hard.exclusions=['edm'];const preserved=base().hard;if(configured)preserved.exclusions=['edm'];
    assert.equal(groundFestivalExclusion(intent,[configured?'No festival EDM.':'No EDM, especially festival EDM.'],preserved),false);
    assert.deepEqual(intent.hard.exclusions,['edm']);
  }
});
