import test from 'node:test';
import assert from 'node:assert/strict';
import {incompleteExtras,type TorrentFile} from './qbittorrent';
import {connectivityProbeInterval,stalledDecision} from './policy';
import type {AcquisitionTarget,DownloadObservation} from './types';
const files:TorrentFile[]=[{index:0,name:'01.mp3',size:1000,progress:1,priority:1},{index:1,name:'Folder.jpg',size:500,progress:.5,priority:1},{index:2,name:'Album.nfo',size:100,progress:0,priority:1}];
test('an inconclusive diagnostic source error does not freeze recovery for half an hour',()=>{
  assert.equal(connectivityProbeInterval({error:'fetch failed'}),5*60_000);
  assert.equal(connectivityProbeInterval({}),30*60_000);
});
test('only incomplete artwork and text may be skipped when all audio is complete',()=>{
  assert.deepEqual(incompleteExtras(files),[1,2]);
  assert.deepEqual(incompleteExtras(files.map((f,i)=>i?f:{...f,progress:.99})),[]);
  assert.deepEqual(incompleteExtras(files.map((f,i)=>i?f:{...f,priority:0})),[]);
  assert.deepEqual(incompleteExtras([...files,{...files[2],index:3,name:'Album.cue'}]),[]);
  assert.deepEqual(incompleteExtras([...files,{...files[2],index:3,name:'Album.rar'}]),[]);
  assert.deepEqual(incompleteExtras(files.slice(1)),[]);
});
test('ordinary stalled downloads recover in four hours without discarding near-complete audio',()=>{
  const target={id:1,origin:'migration',last_progress_at:new Date(Date.now()-5*3600000).toISOString()} as AcquisitionTarget;
  const observation={progress:.1,availability:.1,speed:0,connectedSeeds:0,downloaded:100,amountLeft:900} as DownloadObservation;
  assert.equal(stalledDecision(target,observation,observation,5)?.action,'replace');
  assert.equal(stalledDecision(target,{...observation,speed:1},observation,5),null);
  assert.equal(stalledDecision(target,{...observation,progress:.99,availability:.99},observation,5),null);
});
