import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultConfig,type PlaylistDefinition} from './types';
import {buildTrackEvidence} from './track-evidence';
import {canonicalIntent,configuredIntent} from './intent-schema';
import {assessCandidate,selectPlaylist,type EvidencedCandidate} from './selection-policy';
const now=Date.parse('2026-10-22T03:00:00Z'),day=86400_000,snapshot={complete:true,stale:false};
function definition(category:PlaylistDefinition['category']='mood'):PlaylistDefinition{return{id:1,revision:1,name:'Mix',category,enabled:true,intent:'',config:{...defaultConfig(category),targetTracks:10,maxTracksPerArtist:2,maxTracksPerAlbum:1},ownerUserId:1,ownerDisplayName:'One',ownerTokenStatus:'active',navidromePlaylistId:'mix',lastRunAt:null,nextRunAt:null,createdAt:'',updatedAt:''}}
function track(id:number,profile:Record<string,unknown>={genre:['jazz'],mood:['warm'],listeningContexts:['dinner']}):EvidencedCandidate{
  const artist='Artist '+id,title='Song '+id,album='Album '+id;
  const evidence=buildTrackEvidence({artist,title,profile,tags:{},provenance:{model:'curator'}});
  return{fileId:id,title,artist,album,year:0,profile,evidence,songId:'native-'+id,listener:{id:'native-'+id,title,artist,album,playCount:0,hasPlayed:false,lastPlayed:null,favourite:false,rating:null,providerIds:{}},exposureCount:0,removedAt:null,score:0,reason:'',origin:'catalog'};
}
test('a single-artist request chooses one eligible group and reports a real shortage without padding',()=>{
  const def=definition('rediscovery');def.config.targetTracks=4;
  const intent=configuredIntent(def,'single');intent.hard.singleArtist=true;intent.hard.favouritesOnly=true;
  const pool=Array.from({length:8},(_,i)=>{const song=track(i+1);song.artist=i<3?'One':'Two';song.album='Album '+i;song.listener!.favourite=i<6;return song});
  const result=selectPlaylist({definition:def,intent,pool,previous:[],snapshot,now});
  assert.equal(new Set(result.items.map(song=>song.artist)).size,1);assert.equal(result.items.length,3);assert.equal(result.evaluation.shortage,1);
  assert.ok(result.items.every(song=>song.listener!.favourite));
  intent.pinnedRecordings=pool.slice(0,1).map(song=>({fileId:song.fileId,recordingKey:song.evidence.recordingKey}));
  const pinned=selectPlaylist({definition:def,intent,pool,previous:[],snapshot,now});assert.equal(pinned.items[0].artist,'One');
});
test('an album-level listening exclusion also rejects an unplayed track on a recently heard album',()=>{
  const def=definition('rediscovery'),intent=configuredIntent(def,'album');intent.hard.excludeRecentlyPlayedAlbums=true;
  const song=track(1);song.listener!.favourite=true;song.albumLastPlayed=new Date(now-day).toISOString();
  assert.equal(assessCandidate(song,def,intent,snapshot,now).eligible,false);
  song.albumLastPlayed=new Date(now-90*day).toISOString();assert.equal(assessCandidate(song,def,intent,snapshot,now).eligible,true);
  assert.equal(assessCandidate(song,def,intent,{complete:true,stale:true},now).eligible,false);
});
test('an explicit vocal override is not silently defeated by lower-priority external credits',()=>{
  const def=definition(),intent=configuredIntent(def,'override');intent.hard.vocal='instrumental';
  const song=track(1);song.evidence=buildTrackEvidence({artist:song.artist,title:song.title,profile:{vocalProfile:['clean_sung']},tags:{},manual:{vocalProfile:['instrumental']},external:[{field:'vocalPresence',value:true,scope:'recording',url:'https://example.com/credits'}]});
  assert.equal(assessCandidate(song,def,intent,snapshot,now).eligible,true);
});
test('mood fit and specific style eligibility cannot be replaced by a broad genre match',()=>{
  const def=definition(),intent=canonicalIntent(configuredIntent({...def,config:{...def.config,genres:['jazz'],moods:['warm'],contexts:['dinner']}},'1'));
  assert.equal(assessCandidate(track(1,{genre:['jazz'],mood:['aggressive']}),def,intent,snapshot,now).eligible,false);
  assert.equal(assessCandidate(track(2),def,intent,snapshot,now).eligible,true);
  intent.hard.requirements=[{field:'genre',values:['downtempo'],match:'any'}];
  assert.equal(assessCandidate(track(3,{genre:['electronic'],style:['techno'],mood:['warm']}),def,intent,snapshot,now).eligible,false);
});
test('broad genres include known substyles without weakening a specific style requirement',()=>{
  const def=definition('depth'),intent=configuredIntent(def,'hierarchy');intent.hard.requirements=[{field:'genre',values:['electronic'],match:'any'}];
  const tripHop=track(1,{genre:['Trip-Hop'],style:['downtempo']});assert.equal(assessCandidate(tripHop,def,intent,snapshot,now).eligible,true);
  intent.hard.requirements=[{field:'style',values:['melodic_techno'],match:'any'}];assert.equal(assessCandidate(tripHop,def,intent,snapshot,now).eligible,false);
});
test('a scene or artist association cannot substitute for track genre/style evidence',()=>{
  const def=definition('chat'),intent=configuredIntent(def,'direction');intent.soft.styles=['trip_hop'];
  const sceneOnly=track(1,{genre:['electronic'],style:['downtempo','chillout'],scenes:['bristol_trip_hop_scene']});
  assert.equal(assessCandidate(sceneOnly,def,intent,snapshot,now).eligible,false);
  const trackStyle=track(2,{genre:['electronic'],style:['trip_hop'],scenes:['bristol_trip_hop_scene']});
  assert.equal(assessCandidate(trackStyle,def,intent,snapshot,now).eligible,true);
});
test('Discovery reserves 30% for evidenced neighbouring styles while strict requests and shortages stay visible',()=>{
  const def=definition('discovery'),intent=configuredIntent(def,'adjacency');intent.soft.styles=['melodic_techno'];
  const familiar=Array.from({length:20},(_,i)=>track(i+1,{genre:['electronic'],style:['melodic_techno']}));
  const adjacent=Array.from({length:20},(_,i)=>track(i+21,{genre:['electronic'],style:['dub_techno']}));
  const unrelated=track(99,{genre:['rock'],style:['alternative_rock']});
  const result=selectPlaylist({definition:def,intent,pool:[...familiar,...adjacent,unrelated],previous:[],snapshot,now});
  assert.equal(result.items.length,10);assert.equal(result.items.filter(track=>track.adjacent).length,3);assert.ok(!result.items.some(track=>track.fileId===99));
  assert.ok(result.items.filter(track=>track.adjacent).every(track=>track.reason.includes('Curator’s documented style map')));
  const shortage=selectPlaylist({definition:def,intent,pool:familiar,previous:[],snapshot,now});assert.equal(shortage.items.length,10);assert.ok(shortage.evaluation.relaxations.some(reason=>reason.includes('Adjacent-style share reduced')));
  intent.hard.requirements=[{field:'style',values:['melodic_techno'],match:'all'}];
  const strict=selectPlaylist({definition:def,intent,pool:[...familiar,...adjacent],previous:[],snapshot,now});assert.ok(strict.items.every(track=>!track.adjacent));
});
test('strict instrumental piano requirements reject missing, contradictory and spoken evidence',()=>{
  const def=definition('depth'),intent=configuredIntent(def,'1');
  intent.hard.vocal='instrumental';intent.hard.requirements=[{field:'instrumentation',values:['piano'],match:'all'}];
  for(const vocal of [[],['spoken'],['instrumental','clean_sung']])assert.equal(assessCandidate(track(1,{vocalProfile:vocal,instrumentation:['piano']}),def,intent,snapshot,now).eligible,false);
  assert.equal(assessCandidate(track(1,{vocalProfile:['instrumental'],instrumentation:['guitar']}),def,intent,snapshot,now).eligible,false);
  const valid=assessCandidate(track(1,{vocalProfile:['instrumental'],instrumentation:['piano']}),def,intent,snapshot,now);
  assert.equal(valid.eligible,true);assert.ok(valid.uncertainty.includes('vocalProfile is model inference'));
});
test('Discovery preserves its familiar-style share before relaxing album variety',()=>{
  const def=definition('discovery');def.config.targetTracks=12;
  const intent=configuredIntent(def,'lane-capacity');intent.soft.styles=['melodic_techno'];
  const familiar=Array.from({length:20},(_,i)=>({...track(i+1,{genre:['electronic'],style:['melodic_techno']}),artist:'Familiar '+Math.floor(i/5),album:'Only album'}));
  const adjacent=Array.from({length:20},(_,i)=>track(i+101,{genre:['electronic'],style:['dub_techno']}));
  const result=selectPlaylist({definition:def,intent,pool:[...familiar,...adjacent],previous:[],snapshot,now});
  assert.equal(result.items.length,12);assert.equal(result.items.filter(track=>track.adjacent).length,4);
  assert.equal(result.evaluation.diversityLimits?.album,2);
  assert.ok(!result.evaluation.relaxations.some(reason=>reason.includes('share expanded')));
});
test('Discovery searches the whole adjacent lane and relaxes variety only enough for its share',()=>{
  const def=definition('discovery'),intent=configuredIntent(def,'adjacent-lane');intent.soft.styles=['melodic_techno'];
  const familiar=Array.from({length:20},(_,i)=>track(i+1,{genre:['electronic'],style:['melodic_techno']}));
  const adjacent=Array.from({length:8},(_,i)=>({...track(i+101,{genre:['electronic'],style:['dub_techno']}),artist:'Adjacent artist',album:'Adjacent album'}));
  const result=selectPlaylist({definition:def,intent,pool:[...familiar,...adjacent],previous:[],snapshot,now});
  assert.equal(result.items.length,10);assert.equal(result.items.filter(track=>track.adjacent).length,3);
  assert.ok(!result.evaluation.relaxations.some(reason=>reason.includes('share reduced')));
});
test('rediscovery needs exact-song enjoyment and a known old date when played',()=>{
  const def=definition('rediscovery'),intent=configuredIntent(def,'1'),song=track(1);
  assert.equal(assessCandidate(song,def,intent,snapshot,now).eligible,false);
  song.listener!.hasPlayed=true;song.listener!.playCount=5;
  assert.equal(assessCandidate(song,def,intent,snapshot,now).eligible,false);
  song.listener!.lastPlayed=new Date(now-90*day).toISOString();assert.equal(assessCandidate(song,def,intent,snapshot,now).eligible,true);
  song.listener!.lastPlayed=new Date(now-day).toISOString();assert.equal(assessCandidate(song,def,intent,snapshot,now).eligible,false);
  song.listener!.hasPlayed=false;song.listener!.playCount=0;song.listener!.lastPlayed=null;song.listener!.favourite=true;
  assert.equal(assessCandidate(song,def,intent,snapshot,now).eligible,true);
});
test('discovery novelty uses complete history, not release age or a truncated response',()=>{
  const def=definition('discovery'),intent=configuredIntent(def,'1'),old=track(1);old.year=1972;
  const unheard=assessCandidate(old,def,intent,snapshot,now);
  const stale=assessCandidate(old,def,intent,{complete:true,stale:true},now);
  assert.equal(unheard.eligible,true);assert.ok(unheard.score>stale.score);assert.ok(stale.uncertainty.length);
});
test('fourteen nights preserve rotation, pins, order and removal cooldown',()=>{
  const def=definition('depth'),intent=configuredIntent(def,'1'),pool=Array.from({length:180},(_,i)=>track(i+1));
  intent.pinnedRecordings=[{fileId:1,recordingKey:pool[0].evidence.recordingKey}];intent.positionLocks=[{fileId:1,position:0}];
  let previous:EvidencedCandidate[]=[],removed=new Map<string,number>();
  for(let night=0;night<14;night++){
    const time=now+night*day;
    for(const item of pool)item.removedAt=removed.get(item.evidence.recordingKey)??null;
    const result=selectPlaylist({definition:def,intent,pool,previous,snapshot,now:time});
    assert.equal(result.items.length,10);assert.equal(result.items[0].fileId,1);assert.deepEqual(result.evaluation.violations,[]);
    if(night){assert.equal(result.evaluation.changed,3);assert.equal(result.evaluation.retained,7)}
    const keys=new Set(result.items.map(item=>item.evidence.recordingKey));
    for(const item of result.items)assert.ok(!removed.has(item.evidence.recordingKey));
    for(const item of previous)if(!keys.has(item.evidence.recordingKey))removed.set(item.evidence.recordingKey,time);
    previous=result.items;
  }
});
test('pins never override later exclusions, duplicate recordings or count shortages',()=>{
  const def=definition('chat'),intent=configuredIntent(def,'1'),one=track(1),copy={...track(2),evidence:one.evidence},bad=track(3,{vocalProfile:['clean_sung']});
  intent.hard.vocal='instrumental';intent.pinnedRecordings=[{fileId:3,recordingKey:bad.evidence.recordingKey}];
  one.evidence.fields.vocalProfile={value:['instrumental'],source:'embedded',confidence:'medium',scope:'recording',references:[]};
  const result=selectPlaylist({definition:def,intent,pool:[one,copy,bad],previous:[bad],snapshot,now});
  assert.equal(result.items.length,1);assert.equal(result.evaluation.shortage,9);assert.equal(result.items[0].evidence.recordingKey,one.evidence.recordingKey);
});
test('recording versions and original dates are enforced without trusting edition years',()=>{
  const def=definition('depth'),intent=configuredIntent(def,'1'),studio=track(1,{recordingTypes:['studio_recording']}),live=track(2,{recordingTypes:['live_recording']});
  intent.hard.recording='live';assert.equal(assessCandidate(studio,def,intent,snapshot,now).eligible,false);assert.equal(assessCandidate(live,def,intent,snapshot,now).eligible,true);
  intent.hard.recording='any';intent.hard.minYear=1990;intent.hard.maxYear=1999;studio.evidence.editionYear=1994;
  assert.equal(assessCandidate(studio,def,intent,snapshot,now).eligible,false);studio.evidence.originalYear=1994;
  assert.equal(assessCandidate(studio,def,intent,snapshot,now).eligible,true);
  assert.notEqual(studio.evidence.recordingKey,live.evidence.recordingKey);
});
test('journey sequencing follows the arc after eligibility and retains locked positions',()=>{
  const def=definition('journey');def.config.targetTracks=5;def.config.energyCurve='ascent';
  const intent=configuredIntent(def,'1');intent.hard.requirements=[{field:'genre',values:['rock'],match:'any'}];
  const pool=['very_low','low','medium','high','very_high'].map((energy,i)=>track(i+1,{genre:['rock'],energy}));pool.push(track(8,{genre:['ambient'],energy:'very_low'}));
  const result=selectPlaylist({definition:def,intent,pool,previous:[],snapshot,now});
  assert.deepEqual(result.items.map(t=>t.profile.energy),['very_low','low','medium','high','very_high']);assert.equal(result.items.length,5);
  intent.energyCurve='descent';
  const descending=selectPlaylist({definition:def,intent,pool,previous:[],snapshot,now});
  assert.equal(descending.items[0].profile.energy,'very_high');assert.ok(['very_low','low'].includes(String(descending.items.at(-1)?.profile.energy)));
  assert.equal(def.config.energyCurve,'ascent','Resolved intent does not rewrite the saved control');
});
test('wave sequencing reserves a calm landing even when only two low-energy tracks were selected',()=>{
  const def=definition('journey');def.config.targetTracks=12;const intent=configuredIntent(def,'wave');intent.energyCurve='wave';
  const pool=Array.from({length:12},(_,i)=>track(i+1,{genre:['electronic'],energy:i<2?'low':'high'}));
  const selected=selectPlaylist({definition:def,intent,pool,previous:[],snapshot,now});
  assert.equal(selected.items[0].profile.energy,'low');assert.equal(selected.items.at(-1)?.profile.energy,'low');assert.equal(selected.items[6].profile.energy,'high');
  assert.equal(new Set(selected.items.map(track=>track.fileId)).size,12);
});
test('festival EDM exclusions cover canonical big-room labels without banning all house music',()=>{
  const def=definition('discovery'),intent=configuredIntent(def,'festival');intent.hard.exclusions=['festival_edm'];
  assert.equal(assessCandidate(track(1,{genre:['electronic'],style:['big_room_house']}),def,intent,snapshot,now).eligible,false);
  assert.equal(assessCandidate(track(2,{genre:['electronic'],style:['deep_house']}),def,intent,snapshot,now).eligible,true);
});
test('narrow pools use the smallest feasible variety relaxation and retain configured rotation afterwards',()=>{
  const def=definition('depth');def.config.targetTracks=12;const intent=configuredIntent(def,'1');
  const pool:EvidencedCandidate[]=[];let id=1;
  for(const[artist,albumCount]of [['A',3],['B',2],['C',1],['D',1],['E',1]] as const)for(let album=0;album<albumCount;album++)for(let song=0;song<5;song++){
    const item=track(id++);item.artist=artist;item.album=artist+' Album '+album;item.evidence=buildTrackEvidence({artist,title:item.title,profile:item.profile,tags:{}});pool.push(item);
  }
  const first=selectPlaylist({definition:def,intent,pool,previous:[],snapshot,now});assert.equal(first.items.length,12);assert.deepEqual(first.evaluation.diversityLimits,{artist:3,album:2});
  assert.equal(first.evaluation.artistDiversity,5);
  const next=selectPlaylist({definition:def,intent,pool,previous:first.items,snapshot,now:now+day});assert.equal(next.items.length,12);assert.equal(next.evaluation.retained,8);assert.equal(next.evaluation.changed,4);
});
test('strict tempo ranges reject model guesses and ambiguous audio estimates',()=>{
  const def=definition('journey'),intent=configuredIntent(def,'1'),item=track(1,{genre:['jazz'],bpm:110});intent.hard.minBpm=100;intent.hard.maxBpm=120;
  assert.equal(assessCandidate(item,def,intent,snapshot,now).eligible,false);
  item.evidence.fields.bpm={value:110,source:'audio',scope:'recording',confidence:'medium',references:[],note:'Half/double-time ambiguity'};
  assert.equal(assessCandidate(item,def,intent,snapshot,now).eligible,false);
  item.evidence.fields.bpm={value:110,source:'embedded',scope:'recording',confidence:'medium',references:[]};assert.equal(assessCandidate(item,def,intent,snapshot,now).eligible,true);
});
test('bass alone is not a guitar arrangement and Live Forever is not a live-version annotation',()=>{
  const def=definition('journey'),intent=configuredIntent(def,'1');intent.hard.requirements=[{field:'instrumentation',values:['guitar'],match:'any'}];
  assert.equal(assessCandidate(track(1,{instrumentation:['bass_guitar']}),def,intent,snapshot,now).eligible,false);
  assert.equal(assessCandidate(track(2,{instrumentation:['electric_guitar']}),def,intent,snapshot,now).eligible,true);
  intent.hard.requirements=[];intent.hard.recording='live';const song=track(3,{recordingTypes:['studio_recording']});song.title='Live Forever';
  assert.equal(assessCandidate(song,def,intent,snapshot,now).eligible,false);song.title='Song (Live at the venue)';assert.equal(assessCandidate(song,def,intent,snapshot,now).eligible,true);
});
