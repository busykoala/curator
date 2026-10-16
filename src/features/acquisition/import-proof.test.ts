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

test('complete multi-disc proofs use disc evidence, bounded typos and verified recording aliases without waiving variants',()=>{
  const labels=['Blue Bossa','Atabaque','Recado Bossa Nova','Batida Diferente','One Note Samba','Blue Bossa','Samba Saravah','How Insensitive Insensatez','Cristo Redentor','Quiet Nights'];
  const catalogue:ReleaseTrack[]=labels.map((title,i)=>({id:i+1,albumId:10,artistId:20,title:title+' (2005 Digital Remaster)',duration:180000,absoluteTrackNumber:i%5+1,mediumNumber:Math.floor(i/5)+1}));
  const files:ImportRow[]=labels.map((title,i)=>({path:`/data/downloads/Compilation/Disc ${Math.floor(i/5)+1}/${i%5+1} ${title}.flac`,quality:{quality:{name:'FLAC'}},audioTags:{title,artistTitle:'Various Artists¨¨',trackNumbers:[i%5+1],duration:'00:03:00.1'}}));
  files[1]={...files[1],path:'/data/downloads/Compilation/Disc 1/2 Arabaque.flac',audioTags:{...files[1].audioTags,title:'Arabaque'}};
  files[7]={...files[7],path:'/data/downloads/Compilation/Disc 2/3 How Insensitive.flac',audioTags:{...files[7].audioTags,title:'How Insensitive'}};
  const run=(f=files,t=catalogue)=>proveRelease(f,t,30,10,20,'Various Artists');
  assert.equal(run(),undefined);
  catalogue[7].titleAliases=['Insensatez (How Insensitive)','How Insensitive'];
  const proof=run()!;assert.equal(proof.files.length,10);
  assert.equal(proof.files.find(f=>f.row.path.includes('Disc 2/1'))?.track.id,6);
  assert.equal(run(files.slice(1)),undefined);
  assert.equal(run(files.map((r,i)=>i?r:{...r,audioTags:{...r.audioTags,discNumber:2}})),undefined);
  assert.equal(run(files.map((r,i)=>i?r:{...r,audioTags:{...r.audioTags,artistTitle:'Another Artist'}})),undefined);
  assert.equal(run(files.map((r,i)=>i?r:{...r,audioTags:{...r.audioTags,duration:'00:03:30'}})),undefined);
  const secondTypo=files.map((r,i)=>i!==2?r:{...r,path:'/data/downloads/Compilation/Disc 1/3 Recado Boss Nova.flac',audioTags:{...r.audioTags,title:'Recado Boss Nova'}});
  assert.equal(run(secondTypo),undefined);
  const checked=proof.files.map(({row,track})=>({...row,artist:{id:20},album:{id:10},albumReleaseId:30,tracks:[{id:track.id}],rejections:[{reason:'Worst track match: 56.7 % vs 60 % [track title]'}]}));
  assert.equal(acceptsProvenImport(checked,proof,10,20),true);
  assert.equal(acceptsProvenImport(checked.map((r,i)=>i?r:{...r,rejections:[{reason:'File is not wanted'}]}),proof,10,20),false);
  const live=catalogue.map((t,i)=>i===7?{...t,title:t.title+' (Live)',titleAliases:['How Insensitive']}:t);
  assert.equal(run(files,live),undefined);
});
