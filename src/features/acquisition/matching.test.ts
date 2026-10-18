import test from "node:test";
import assert from "node:assert/strict";
import {conflictingAlbum,matchesAlbum,releaseQuality,repairedTitle, type CatalogAlbum} from "./matching";
const album=(title:string,releaseDate='1975-01-01'):CatalogAlbum=>({id:1,artistId:1,title,releaseDate,monitored:true});
const item=(title:string,extra={})=>({title,...extra});
test('short catalogue aliases cannot turn studio audio into a cast recording or a meditation edition into the standard album',()=>{
 const broadway={...album('American Idiot: The Original Broadway Cast Recording','2010-01-01'),releases:[{title:'American Idiot'}]};
 const raw=item('Green Day - American Idiot (2004) [2012 Remastered Hi-Res 24-48] FLAC 88');
 assert.equal(matchesAlbum(raw,broadway,'Green Day'),false);
 assert.equal(matchesAlbum(raw,broadway,'Green Day',{artist:{id:1},albums:[{id:1}]}),false);
 assert.equal(matchesAlbum(item('Green Day - American Idiot The Original Broadway Cast Recording (2010) FLAC'),broadway,'Green Day'),true);
 assert.equal(matchesAlbum(item('Green Day - American Idiot Original Broadway Cast (2010) FLAC'),broadway,'Green Day'),true);
 assert.equal(matchesAlbum(item('Above & Beyond - Flow State Meditations (2020) FLAC'),album('Flow State','2019-01-01'),'Above & Beyond'),false);
 assert.equal(matchesAlbum(item('Above & Beyond - Flow State (2019) FLAC'),album('Flow State','2019-01-01'),'Above & Beyond'),true);
});
test('a shared studio title is insufficient evidence for a multi-album box set',()=>{
  const box={...album('Catch a Fire','2006-10-04'),disambiguation:'Disk Union box set',releases:[{title:'Catch a Fire',mediumCount:11}]};
  assert.equal(matchesAlbum(item('Bob Marley & The Wailers - Catch A Fire (50th Anniversary) (2023 Reggae) FLAC'),box,'Bob Marley & The Wailers'),false);
  assert.equal(matchesAlbum(item('Bob Marley & The Wailers - Catch A Fire 11CD FLAC'),box,'Bob Marley & The Wailers'),true);
});
test('explicit 24-bit evidence survives truncated indexer titles without inferring quality from file size',()=>{
  const quality={quality:{name:'FLAC'}};
  assert.equal(releaseQuality({title:'Artist - Album [Flac 24 96 LP]',quality}),'FLAC 24bit');
  assert.equal(releaseQuality({title:'Artist - Album [Flac 2..',quality,guid:'1_magnet:?xt=urn:btih:abc&dn=Artist+-+Album+[FLAC+24-96]'}),'FLAC 24bit');
  assert.equal(releaseQuality({title:'Artist - 24 Carat Gold [FLAC]',quality,size:3e9}),'FLAC');
  assert.equal(releaseQuality({title:'Artist - Album [24bit]',quality:{quality:{name:'MP3-320'}}}),'MP3-320');
});
test('recognizes actual parser failures without accepting similar recordings',()=>{
  assert.ok(matchesAlbum(item('Quincy Jones - Big Band Bossa Nova (Original Album Plus Bonus Tracks 1962) (1962 Pop) [Flac 16-44]'),album('Big Band Bossa Nova','1962-01-01'),'Quincy Jones'));
  assert.equal(matchesAlbum(item('Quincy Jones - Big Band Bossa Nova (The Lost Album) FLAC'),album('Big Band Bossa Nova','1962-01-01'),'Quincy Jones'),false);
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
  assert.match(first,/\[src-[a-p]{12}\]$/);
  assert.notEqual(first,repairedTitle({title:'Khatia Buniatishvili Labyrinth',guid:'source-two'},target,'Khatia Buniatishvili'));
});
test('artist aliases require a verified original native identity and cannot waive recording variants',()=>{
  const target=album('Soul Rebels','1970-01-01');
  const source=item('Bob Marley - Soul Rebels (1970) FLAC');
  assert.equal(matchesAlbum(source,target,'Bob Marley & The Wailers'),false);
  assert.equal(matchesAlbum(source,target,'Bob Marley & The Wailers',{artist:{id:1},albums:[{id:1}]}),true);
  assert.equal(matchesAlbum(source,target,'Bob Marley & The Wailers',{artist:{id:2},albums:[{id:1}]}),false);
  assert.equal(matchesAlbum(item('Bob Marley - Soul Rebels (Source Materials) FLAC'),target,'Bob Marley & The Wailers',{artist:{id:1},albums:[{id:1}]}),false);
});
test('does not confuse volumes, compilation fragments, or ambiguous generic titles',()=>{
  assert.equal(matchesAlbum(item('Queen - Greatest Hits I,II,III FLAC'),album('Greatest Hits I & II'),'Queen'),false);
  const past={...album('Past Masters Volumes One & Two'),releases:[{title:'Past Masters Volume Two'}]};
  assert.equal(matchesAlbum(item('The Beatles - Past Masters Volume Two FLAC'),past,'The Beatles'),false);
  assert.equal(matchesAlbum(item('Bob Marley & The Wailers - Legend The Best of Bob Marley FLAC',{rejected:true}),album('Best of Bob Marley'),'Bob Marley & The Wailers'),false);
  const generic=album('Greatest Hits','1981-01-01'),release=item('Queen - Greatest Hits (1981) FLAC');
  assert.equal(matchesAlbum(release,generic,'Queen'),false);
  assert.equal(matchesAlbum(release,generic,'Queen',{artist:{id:1},albums:[{id:1}]}),true);
  assert.equal(matchesAlbum(release,generic,'Queen',{artist:{id:1},albums:[{id:2}]}),false);
  assert.equal(matchesAlbum(release,generic,'Queen',{artist:{id:1},albums:[{id:1},{id:2}]}),false);
  assert.equal(matchesAlbum(item('Queen - Greatest Hits III (1981) FLAC'),generic,'Queen',{artist:{id:1},albums:[{id:2}]}),false);
});
