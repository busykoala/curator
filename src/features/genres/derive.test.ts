import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveAlbumGenres,type AlbumGenreInput,type TrackGenreInput} from './derive';
import {familyOf,resolveStyle} from './style-map';

const track=(fileId:number,extra:Partial<TrackGenreInput>={}):TrackGenreInput=>({fileId,artist:'Artist',llmGenres:[],llmStyles:[],...extra});
const album=(tracks:TrackGenreInput[],extra:Partial<AlbumGenreInput>={}):AlbumGenreInput=>({albumKey:'k',albumArtist:'Artist',tracks,musicbrainzTags:[],...extra});
const folkRock={styles:[{label:'Rock---Folk Rock',p:0.45},{label:'Folk, World, & Country---Folk',p:0.3},{label:'Rock---Soft Rock',p:0.1}]};

test('one album gets one family and main style even when the LLM disagreed per track',()=>{
  const result=deriveAlbumGenres(album([
    track(1,{audio:folkRock,llmGenres:['folk_acoustic'],llmStyles:['folk_rock','singer_songwriter']}),
    track(2,{audio:folkRock,llmGenres:['rock'],llmStyles:['folk_rock','pop_rock']}),
  ],{musicbrainzTags:[{name:'folk rock',count:5},{name:'folk',count:3}]}));
  assert.deepEqual(result.map(r=>r.genreTag),[['Rock','Folk Rock'],['Rock','Folk Rock']]);
  assert.ok(!result[0].styleTag.includes('Folk Rock'),'the main style is not repeated in STYLE');
  assert.equal(result[0].cluster,'rock.soft_folk');
});

test('a metadata-only LLM guess cannot outvote what the recording sounds like',()=>{
  const [result]=deriveAlbumGenres(album([track(1,{audio:{styles:[{label:'Rock---Hard Rock',p:0.6},{label:'Rock---Classic Rock',p:0.3}]},llmGenres:['classical'],llmStyles:['orchestral','traditional']})]));
  assert.equal(result.family,'Rock');
});

test('compilations are decided per track',()=>{
  const result=deriveAlbumGenres(album([
    track(1,{artist:'A',audio:{styles:[{label:'Jazz---Cool Jazz',p:0.7}]}}),
    track(2,{artist:'B',audio:{styles:[{label:'Electronic---Downtempo',p:0.7}]}}),
    track(3,{artist:'C',audio:{styles:[{label:'Jazz---Bossa Nova',p:0.7}]}}),
    track(4,{artist:'D',audio:{styles:[{label:'Hip Hop---Jazzy Hip-Hop',p:0.7}]}}),
  ],{albumArtist:'Various Artists'}));
  assert.deepEqual(result.map(r=>r.family),['Jazz','Electronic','Jazz','Hip-Hop']);
});

test('a track departs from its album only on strong audio evidence',()=>{
  const rock={styles:[{label:'Rock---Classic Rock',p:0.7}]};
  const result=deriveAlbumGenres(album([track(1,{audio:rock}),track(2,{audio:rock}),track(3,{audio:{styles:[{label:'Classical---Romantic',p:0.85}]},llmGenres:['classical']}),track(4,{audio:{styles:[{label:'Rock---Classic Rock',p:0.3},{label:'Classical---Romantic',p:0.35}]}}),track(5,{audio:{styles:[{label:'Folk, World, & Country---Éntekhno',p:0.8}]},llmGenres:['rock']})]));
  assert.deepEqual(result.map(r=>r.family),['Rock','Rock','Classical','Rock','Rock'],'a lone audio misfire stays with the album');
});

test('manual overrides win and evidence without audio still works',()=>{
  const [manual]=deriveAlbumGenres(album([track(1,{audio:folkRock,manual:{genres:['jazz'],styles:['cool_jazz']}})]));
  assert.deepEqual(manual.genreTag,['Jazz','Cool Jazz']);assert.equal(manual.confidence,1);
  const [llmOnly]=deriveAlbumGenres(album([track(1,{llmGenres:['electronic'],llmStyles:['trip_hop','downtempo']})]));
  assert.deepEqual(llmOnly.genreTag,['Electronic','Trip Hop']);
});

test('regex-era family mistakes are gone',()=>{
  for(const [style,family] of [['dubstep','Electronic'],['dub_techno','Electronic'],['trip_hop','Electronic'],['folk_rock','Rock'],['chamber_pop','Pop'],['post_punk','Rock'],['nu_disco','Electronic'],['hardcore_hip_hop','Hip-Hop'],['happy_hardcore','Electronic'],['ukrainian_folk','Folk'],['jazz_rap','Hip-Hop'],['pop_punk','Punk']] as const)
    assert.equal(resolveStyle(style)?.family,family,style);
  assert.equal(familyOf('rnb_soul_funk'),'Soul & R&B');
});
test('an artist’s other albums tip a borderline album toward the same family',()=>{
  const nearTie={styles:[{label:'Folk, World, & Country---Folk',p:0.42},{label:'Rock---Folk Rock',p:0.4}]};
  const borderline=[track(1,{audio:nearTie}),track(2,{audio:nearTie})];
  assert.equal(deriveAlbumGenres(album(borderline))[0].family,'Folk');
  assert.equal(deriveAlbumGenres(album(borderline,{artistFamilies:{Rock:40}}))[0].family,'Rock');
  const clear=[track(1,{audio:{styles:[{label:'Jazz---Cool Jazz',p:0.8}]}})];
  assert.equal(deriveAlbumGenres(album(clear,{artistFamilies:{Rock:40}}))[0].family,'Jazz','a clear recording is not overruled by the artist prior');
});
test('featured guests do not turn an artist album into a compilation; bare family words are not styles',()=>{
  const swing={styles:[{label:'Jazz---Swing',p:0.4},{label:'Pop---Vocal',p:0.2}]};
  const tracks=['Michael Bublé','Michael Bublé feat. Nelly Furtado','Michael Bublé & Shania Twain','Michael Bublé with Bryan Adams','Michael Bublé'].map((artist,i)=>track(i+1,{artist,audio:swing,llmGenres:['jazz'],llmStyles:['jazz','swing']}));
  const result=deriveAlbumGenres(album(tracks,{albumArtist:'Michael Bublé'}));
  assert.ok(result.every(r=>r.family==='Jazz'&&r.genreTag[1]==='Swing'),JSON.stringify(result.map(r=>r.genreTag)));
  assert.ok(result.every(r=>!r.styleTag.includes('Jazz')));
  assert.equal(resolveStyle('electronic'),undefined);assert.equal(resolveStyle('ambient')?.display,'Ambient');
});
