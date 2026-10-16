import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptsProvenImport,proveRelease,type ImportRow,type ReleaseTrack} from './import-proof';
const tracks:ReleaseTrack[]=['Bleeding Heart','Highway Chile','3 Little Bears'].map((title,i)=>({id:i+1,albumId:10,artistId:20,title,duration:180000,absoluteTrackNumber:i+1,mediumNumber:1}));
const rows:ImportRow[]=['Bleeding Heart','Highway Chile','Three Little Bears'].map((title,i)=>({path:`/data/downloads/Jimi Hendrix - War Heroes/${i+1}. - ${title}.flac`,audioTags:{duration:'00:03:00.1'},quality:{quality:{name:'FLAC 24bit'}}}));
const prove=(files=rows,ts=tracks)=>proveRelease(files,ts,30,10,20,'Jimi Hendrix');
test('untagged audio requires a complete unique track list, positions and close durations',()=>{
  assert.equal(prove()?.files.length,3);
  assert.equal(prove(rows.slice(1)),undefined);
  assert.equal(prove([...rows,rows[0]]),undefined);
  assert.equal(prove(rows.map((r,i)=>i?r:{...r,audioTags:{duration:'00:03:30'}})),undefined);
  assert.equal(prove(rows.map((r,i)=>i?r:{...r,path:'/data/downloads/Other/1. Midnight.flac'})),undefined);
  assert.equal(prove(rows.map((r,i)=>i?r:{...r,path:'/data/downloads/../library/1. Bleeding Heart.flac'})),undefined);
  assert.equal(prove(rows,tracks.map((t,i)=>i?t:{...t,hasFile:true})),undefined);
  assert.equal(prove(rows,tracks.map((t,i)=>i?t:{...t,artistId:99})),undefined);
  assert.equal(prove(rows.map((r,i)=>i?r:{...r,quality:{quality:{name:'MP3-128'}}})),undefined);
  assert.equal(prove(rows.map((r,i)=>i?r:{...r,audioTags:{...r.audioTags,artistTitle:'Other Artist'}})),undefined);
});
test('redundant CUE image is excluded only after all split audio and total duration agree',()=>{
  const image:ImportRow={path:'/data/downloads/Jimi Hendrix - War Heroes/image.flac',audioTags:{duration:'00:09:00.3'},quality:{quality:{name:'FLAC'}}};
  assert.deepEqual(prove([...rows,image])?.excludedImages,[image.path]);
  assert.equal(prove([...rows,{...image,audioTags:{duration:'00:10:00'}}]),undefined);
});
test('native mappings must agree exactly and only metadata-confidence rejection can remain',()=>{
  const proof=prove()!;
  const checked=rows.map((r,i)=>({...r,artist:{id:20},album:{id:10},albumReleaseId:30,tracks:[{id:tracks[i].id}],rejections:[{reason:'Album match is not close enough: 60.8 % vs 80 % [artist, album, tracks]'}]}));
  assert.equal(acceptsProvenImport(checked,proof,10,20),true);
  assert.equal(acceptsProvenImport(checked.slice(1),proof,10,20),false);
  assert.equal(acceptsProvenImport(checked.map((r,i)=>i?r:{...r,rejections:[{reason:'Has missing tracks'}]}),proof,10,20),false);
  assert.equal(acceptsProvenImport(checked.map((r,i)=>i?r:{...r,tracks:[{id:99}]}),proof,10,20),false);
});
