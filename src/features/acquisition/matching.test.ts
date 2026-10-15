import test from "node:test";
import assert from "node:assert/strict";
import {conflictingAlbum,matchesAlbum,releaseQuality,repairedTitle, type CatalogAlbum} from "./matching";
const album=(title:string,releaseDate='1975-01-01'):CatalogAlbum=>({id:1,artistId:1,title,releaseDate,monitored:true});
const item=(title:string,extra={})=>({title,...extra});
test('explicit 24-bit evidence survives truncated indexer titles without inferring quality from file size',()=>{
  const quality={quality:{name:'FLAC'}};
  assert.equal(releaseQuality({title:'Artist - Album [Flac 24 96 LP]',quality}),'FLAC 24bit');
  assert.equal(releaseQuality({title:'Artist - Album [Flac 2..',quality,guid:'1_magnet:?xt=urn:btih:abc&dn=Artist+-+Album+[FLAC+24-96]'}),'FLAC 24bit');
  assert.equal(releaseQuality({title:'Artist - 24 Carat Gold [FLAC]',quality,size:3e9}),'FLAC');
  assert.equal(releaseQuality({title:'Artist - Album [24bit]',quality:{quality:{name:'MP3-320'}}}),'MP3-320');
});
test('recognizes actual parser failures without accepting similar recordings',()=>{
  assert.ok(matchesAlbum(item('Green Day  ¡Uno   (2012) [FLAC] 88'),album('¡Uno!','2012-01-01'),'Green Day'));
  assert.ok(matchesAlbum(item('Bob-Marley- -The-Wailers--Rastaman-Vibration-(UHQR)-PBTHAL-(1976-Reggae)-[Flac-2..'),album('Rastaman Vibration','1976-01-01'),'Bob Marley & The Wailers'));
  assert.ok(matchesAlbum(item('Metallica &amp; The San Francisco Symphony   S&amp;M2 FLAC'),album('S&M2','2020-01-01'),'Metallica'));
  assert.ok(matchesAlbum(item('Dire Straits And Mark Knopfler The Best Of: Private Investigations (2005) FLAC'),album('The Best of Dire Straits & Mark Knopfler: Private Investigations','2005-01-01'),'Dire Straits'));
  assert.ok(matchesAlbum(item('Fleetwood Mac - Fleetwood Mac (1975) FLAC',{albumTitle:'Fleetwood Mac'}),album('Fleetwood Mac'),'Fleetwood Mac'));
  assert.equal(matchesAlbum(item('Fleetwood Mac - Fleetwood Mac 1975 to 1987 (2025) FLAC',{albumTitle:'Fleetwood Mac'}),album('Fleetwood Mac'),'Fleetwood Mac'),false);
  assert.equal(matchesAlbum(item('Fleetwood Mac - Fleetwood Mac Live 1975 FLAC',{albumTitle:'Fleetwood Mac'}),album('Fleetwood Mac'),'Fleetwood Mac'),false);
  assert.equal(matchesAlbum(item('Delores Keane - The Best of FLAC'),album('The Best of Keane'),'Keane'),false);
  assert.equal(matchesAlbum(item('The Beatles - Yellow Submarine (Instrumentals) FLAC'),album('Yellow Submarine'),'The Beatles'),false);
  assert.equal(matchesAlbum(item('Solomun - Nobody Is Not Loved Remixed (2022) FLAC'),album('Nobody Is Not Loved','2021-01-01'),'Solomun'),false);
  assert.equal(matchesAlbum(item('Aim - Cold Water Music EP (2000) FLAC'),album('Cold Water Music','1999-01-01'),'Aim'),false);
  assert.equal(matchesAlbum(item('Hidden-Orchestra--Archipelago-(Source-Materials)-(2022)-Mp3-320kbps',{albumTitle:'Archipelago'}),album('Archipelago','2012-01-01'),'Hidden Orchestra'),false);
  assert.ok(matchesAlbum(item('Hidden Orchestra - Archipelago (2012) FLAC'),album('Archipelago','2012-01-01'),'Hidden Orchestra'));
});
test('repairs retain source identity and reject other albums even when the parser cannot resolve them',()=>{
  assert.equal(conflictingAlbum(item('Bob Marley & The Wailers - Rastaman Vibration (UHQR) (1976 Reggae) FLAC'),album('Rastaman Vibration'),[{...album('Reggae'),id:2}],'Bob Marley & The Wailers'),false);
  assert.equal(conflictingAlbum(item('Bob Marley & The Wailers - Rastaman Vibration Reggae FLAC'),album('Rastaman Vibration'),[{...album('Reggae'),id:2}],'Bob Marley & The Wailers'),false);
  const target=album('Labyrinth','2020-01-01');
  assert.equal(conflictingAlbum(item('Khatia Buniatishvili - Labyrinth Ephemera (2024) FLAC'),target,[{...album('Labyrinth Ephemera'),id:2}],'Khatia Buniatishvili'),true);
  assert.equal(conflictingAlbum(item('Khatia Buniatishvili - Labyrinth (2020) FLAC'),target,[{...album('Labyrinth Ephemera'),id:2}],'Khatia Buniatishvili'),false);
  const first=repairedTitle({title:'Khatia Buniatishvili Labyrinth',guid:'source-one'},target,'Khatia Buniatishvili');
  assert.notEqual(first,repairedTitle({title:'Khatia Buniatishvili Labyrinth',guid:'source-two'},target,'Khatia Buniatishvili'));
});
test('does not confuse volumes, compilation fragments, or ambiguous generic titles',()=>{
  assert.equal(matchesAlbum(item('Queen - Greatest Hits I,II,III FLAC'),album('Greatest Hits I & II'),'Queen'),false);
  const past={...album('Past Masters Volumes One & Two'),releases:[{title:'Past Masters Volume Two'}]};
  assert.equal(matchesAlbum(item('The Beatles - Past Masters Volume Two FLAC'),past,'The Beatles'),false);
  assert.equal(matchesAlbum(item('Bob Marley & The Wailers - Legend The Best of Bob Marley FLAC',{rejected:true}),album('Best of Bob Marley'),'Bob Marley & The Wailers'),false);
});
