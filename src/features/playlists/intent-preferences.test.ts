import test from 'node:test';import assert from 'node:assert/strict';
import {configuredIntent,canonicalIntent} from './intent-schema';import {defaultConfig,type PlaylistDefinition} from './types';
import {enforceSoftPreferences,enforceDiscoveryStylePreferences,groundFestivalExclusion,groundClimaxExclusion,groundFavouritesScope,groundPianoPresence,groundRetentionRequest} from './intent-preferences';
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
test('an explicit climax exclusion always covers dynamics and build/drop structure',()=>{
  for(const direction of ['No dramatic climaxes.','Calm music without dramatic climaxes.','Avoid any dramatic climaxes.','Keine dramatischen Höhepunkte.']){
    const intent=base();intent.hard.requirements=[{field:'dynamicCharacter',values:['crescendo_build'],match:'none'}];
    assert.equal(groundClimaxExclusion(intent,[direction]),true);
    assert.deepEqual(intent.hard.requirements,[{field:'dynamicCharacter',values:['crescendo_build'],match:'none'},{field:'structuralCharacter',values:['build_drop'],match:'none'}]);
    groundClimaxExclusion(intent,[direction]);assert.equal(intent.hard.requirements.length,2);
  }
});
test('calm preferences and unrelated percussion exclusions do not invent a climax exclusion',()=>{
  for(const direction of ['Calm instrumental music for reading.','No forceful percussion.','I like dramatic climaxes.']){
    const intent=base();assert.equal(groundClimaxExclusion(intent,[direction]),false);assert.deepEqual(intent.hard.requirements,[]);
  }
});
test('later explicit permission prevents an earlier climax instruction from being reintroduced',()=>{
  const intent=base();assert.equal(groundClimaxExclusion(intent,['No dramatic climaxes.','Dramatic climaxes are fine now.']),false);assert.deepEqual(intent.hard.requirements,[]);
  assert.equal(groundClimaxExclusion(intent,['No dramatic climaxes.','Allow dramatic climaxes.']),false);
  assert.equal(groundClimaxExclusion(intent,['Allow dramatic climaxes.','No dramatic climaxes.']),true);
});
test('forgotten favourites use observed enjoyment unless a native-star filter is explicitly requested',()=>{
  for(const direction of ['My forgotten jazz favourites, not jazz I have never played or favourited.','Old electronic favourites for an evening at home.','Prefer my starred tracks.']){
    const intent=base();intent.hard.favouritesOnly=true;
    assert.equal(groundFavouritesScope(intent,[direction],base().hard),true);assert.equal(intent.hard.favouritesOnly,false);
  }
  for(const direction of ['Only my long-unplayed favourites by one artist.','Nur meine Favoriten.','My starred songs.','My favourited music.','Songs that I have favourited.','Tracks I’ve starred.','Favourites only.']){
    const intent=base();groundFavouritesScope(intent,[direction],base().hard);assert.equal(intent.hard.favouritesOnly,true,direction);
  }
});
test('favourite scope preserves saved hard choices and respects explicit later broadening',()=>{
  const intent=base();intent.hard.favouritesOnly=true;const preserved={...base().hard,favouritesOnly:true};
  groundFavouritesScope(intent,['My forgotten favourites.'],preserved);assert.equal(intent.hard.favouritesOnly,true);
  groundFavouritesScope(intent,['Only my favourites.','Not only favourites; include played tracks too.'],base().hard);assert.equal(intent.hard.favouritesOnly,false);
  groundFavouritesScope(intent,['Only my favourites.','Include unstarred tracks too.'],base().hard);assert.equal(intent.hard.favouritesOnly,false);
  groundFavouritesScope(intent,['Only my favourites.','Make the mood warmer.'],base().hard);assert.equal(intent.hard.favouritesOnly,true);
});
test('piano presence does not invent an unaccompanied performance requirement',()=>{
  const intent=base();intent.hard.vocal='instrumental';intent.hard.requirements=[{field:'genre',values:['jazz'],match:'all'},{field:'style',values:['piano_solo'],match:'all'},{field:'genre',values:['electronic'],match:'none'}];intent.soft.styles=['jazz','piano_solo'];
  assert.equal(groundPianoPresence(intent,['Make every song instrumental piano jazz. No electronic music.'],[]),true);
  assert.deepEqual(intent.hard.requirements,[{field:'genre',values:['jazz'],match:'all'},{field:'genre',values:['electronic'],match:'none'},{field:'instrumentation',values:['piano'],match:'all'}]);
  assert.equal(intent.hard.vocal,'instrumental');assert.deepEqual(intent.soft.styles,['jazz']);
  assert.equal(groundPianoPresence(intent,['Instrumental piano jazz.'],[]),false);
});
test('explicit solo, saved rules, exclusions and mixed alternatives remain intact',()=>{
  for(const direction of ['Solo piano jazz.','Unaccompanied piano.','Piano alone.','Nur Klavier solo.']){
    const intent=base();intent.hard.requirements=[{field:'style',values:['piano_solo'],match:'all'}];assert.equal(groundPianoPresence(intent,[direction],[]),false);assert.equal(intent.hard.requirements[0].values[0],'piano_solo');
  }
  for(const rule of [{field:'style',values:['piano_solo'],match:'none'},{field:'style',values:['piano_solo','guitar_rock'],match:'any'}] as const){
    const intent=base();intent.hard.requirements=[{...rule,values:[...rule.values]}];assert.equal(groundPianoPresence(intent,['Piano jazz.'],[]),false);
  }
  const intent=base();intent.hard.requirements=[{field:'style',values:['piano_solo'],match:'all'}];assert.equal(groundPianoPresence(intent,['Piano jazz.'],intent.hard.requirements),false);
});
test('a correction without a real retention request cannot create new pins or positions',()=>{
  const intent=base(),saved={pinnedRecordings:[{fileId:1,recordingKey:'one'}],positionLocks:[{fileId:1,position:0}]};
  intent.pinnedRecordings=[...saved.pinnedRecordings,{fileId:2,recordingKey:'two'}];intent.positionLocks=[...saved.positionLocks,{fileId:2,position:1}];
  assert.equal(groundRetentionRequest(intent,['Relaxed jazz.','Make every song instrumental piano jazz.'],saved),true);
  assert.deepEqual(intent.pinnedRecordings,saved.pinnedRecordings);assert.deepEqual(intent.positionLocks,saved.positionLocks);
  for(const direction of ['Keep the first two.','Bitte die ersten beiden behalten.'])assert.equal(groundRetentionRequest(intent,[direction],saved),false);
});
