import test from 'node:test';import assert from 'node:assert/strict';
import {configuredIntent,canonicalIntent} from './intent-schema';import {defaultConfig,type PlaylistDefinition} from './types';
import {enforceSoftPreferences} from './intent-preferences';
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
