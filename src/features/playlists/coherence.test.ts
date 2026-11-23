import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultConfig,type PlaylistDefinition} from './types';
import {buildTrackEvidence} from './track-evidence';
import {configuredIntent} from './intent-schema';
import {selectPlaylist,type EvidencedCandidate} from './selection-policy';
import {cosine,transitionCost,type CoherenceFacts} from './coherence';

const now=Date.parse('2026-11-22T03:00:00Z'),snapshot={complete:true,stale:false};
function definition(category:PlaylistDefinition['category']='mood'):PlaylistDefinition{return{id:1,revision:1,name:'Blue Hour',category,enabled:true,intent:'',config:{...defaultConfig(category),targetTracks:10,maxTracksPerArtist:2,maxTracksPerAlbum:1,tasteLanes:[],moods:['warm'],contexts:[]},ownerUserId:1,ownerDisplayName:'One',ownerTokenStatus:'active',navidromePlaylistId:'x',lastRunAt:null,nextRunAt:null,createdAt:'',updatedAt:''}}
function track(id:number):EvidencedCandidate{
  const artist='Artist '+id,title='Song '+id,album='Album '+id,profile={genre:['jazz'],mood:['warm'],listeningContexts:['dinner']};
  const evidence=buildTrackEvidence({artist,title,profile,tags:{},provenance:{model:'curator'}});
  return{fileId:id,title,artist,album,year:0,profile,evidence,songId:'n'+id,listener:{id:'n'+id,title,artist,album,playCount:0,hasPlayed:false,lastPlayed:null,favourite:false,rating:null,providerIds:{}},exposureCount:0,removedAt:null,score:0,reason:'',origin:'catalog'};
}
const vector=(...values:number[])=>new Float32Array(values);
// Three sound worlds that all match the mood "warm": vocal jazz, downtempo, jazzy hip-hop.
const world=(id:number):CoherenceFacts=>id<=12?{family:'Jazz',cluster:'jazz.vocal_swing',embedding:vector(1,0.1*(id%3),0)}:id<=20?{family:'Electronic',cluster:'electronic.downtempo',embedding:vector(0,1,0.1*(id%3))}:{family:'Hip-Hop',cluster:'hiphop.jazzy',embedding:vector(0.1,0,1)};

test('a mood playlist keeps one musical centre instead of mixing every warm-sounding style',()=>{
  const pool=Array.from({length:26},(_,i)=>track(i+1)),facts=new Map(pool.map(t=>[t.fileId,world(t.fileId)]));
  const def=definition();
  const plain=selectPlaylist({definition:def,intent:configuredIntent(def,'m'),pool,previous:[],snapshot,now,seed:'s'});
  const coherent=selectPlaylist({definition:def,intent:configuredIntent(def,'m'),pool:pool.map(t=>({...t})),previous:[],snapshot,now,seed:'s',coherence:facts});
  const families=(items:EvidencedCandidate[])=>new Set(items.map(t=>facts.get(t.fileId)!.family));
  assert.ok(families(plain.items).size>1,'fixture: without coherence the mood mixes worlds');
  assert.equal(coherent.items.length,10);
  assert.ok(coherent.evaluation.coherence!.dominantFamilyShare>=0.8,JSON.stringify(coherent.evaluation.coherence));
  assert.deepEqual(coherent.evaluation.coherence!.centre,{family:'Jazz',cluster:'jazz.vocal_swing'});
});

test('yesterday’s off-style tracks are not retained past the cap',()=>{
  const pool=Array.from({length:26},(_,i)=>track(i+1)),facts=new Map(pool.map(t=>[t.fileId,world(t.fileId)]));
  const def=definition();def.config.rotationPercent=30;
  const previous=[...pool.slice(12,20),...pool.slice(0,2)];// mostly downtempo from an earlier, incoherent run
  const result=selectPlaylist({definition:def,intent:configuredIntent(def,'m'),pool,previous,snapshot,now,seed:'s',coherence:facts});
  const outside=result.items.filter(t=>facts.get(t.fileId)!.family!==result.evaluation.coherence!.centre!.family).length;
  assert.ok(outside<=2,`at most 20% outside the centre, got ${outside}`);
});

test('a playlist with too few in-style songs relaxes focus instead of coming up short',()=>{
  const pool=Array.from({length:11},(_,i)=>track(i+16)),facts=new Map(pool.map(t=>[t.fileId,world(t.fileId)]));
  const result=selectPlaylist({definition:definition(),intent:configuredIntent(definition(),'m'),pool,previous:[],snapshot,now,seed:'s',coherence:facts});
  assert.equal(result.items.length,10);
  assert.ok(result.evaluation.relaxations.some(r=>/Stylistic focus relaxed/.test(r)));
});

test('transitions prefer close sounds, the same cluster and nearby decades',()=>{
  const jazz={family:'Jazz',cluster:'jazz.vocal_swing',embedding:vector(1,0,0)},jazz2={family:'Jazz',cluster:'jazz.vocal_swing',embedding:vector(0.95,0.05,0)},hiphop={family:'Hip-Hop',cluster:'hiphop.jazzy',embedding:vector(0,0,1)};
  assert.ok(transitionCost({fact:jazz,year:1959},{fact:jazz2,year:1962})<transitionCost({fact:jazz,year:1959},{fact:hiphop,year:2004}));
  assert.equal(cosine(vector(1,0),vector(1,0)),1);assert.equal(cosine(null,vector(1)),null);
});
test('audiobooks and children’s stories stay out of music playlists unless asked for',async()=>{
  const {assessCandidate}=await import('./selection-policy');
  const story=track(90);story.evidence=buildTrackEvidence({artist:'Fünf Freunde',title:'Folge 1',profile:{genre:['spoken_word_comedy'],style:['audio_drama'],mood:['warm']},tags:{},provenance:{model:'curator'}});
  const def=definition(),intent=configuredIntent(def,'m');
  assert.ok(assessCandidate(story,def,intent,snapshot,now).violations.some(v=>/Spoken word/.test(v)));
  intent.soft.styles=['audio drama'];
  assert.ok(!assessCandidate(story,def,intent,snapshot,now).violations.some(v=>/Spoken word/.test(v)),'an explicit spoken-word playlist may include it');
  assert.ok(!assessCandidate(track(1),def,configuredIntent(def,'m'),snapshot,now).violations.some(v=>/Spoken word/.test(v)),'music is unaffected');
});

test('exclusions name kinds of music, not sound descriptors',async()=>{
  const {assessCandidate}=await import('./selection-policy');
  const def=definition(),intent=configuredIntent(def,'m');intent.hard.exclusions=['electronic','classical'];
  const jazz=track(70);jazz.evidence=buildTrackEvidence({artist:'Norah Jones',title:'Sunrise',profile:{genre:['jazz'],style:['vocal_jazz'],acousticElectronicCharacter:'acoustic_electronic_hybrid',timbre:['warm'],mood:['warm']},tags:{},provenance:{model:'curator'}});
  assert.ok(!assessCandidate(jazz,def,intent,snapshot,now).violations.includes('Explicit exclusion'));
  const synth=track(71);synth.evidence=buildTrackEvidence({artist:'Moderat',title:'Bad Kingdom',profile:{genre:['electronic'],style:['idm'],mood:['warm']},tags:{},provenance:{model:'curator'}});
  assert.ok(assessCandidate(synth,def,intent,snapshot,now).violations.includes('Explicit exclusion'));
});
