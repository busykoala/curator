import test from 'node:test';
import assert from 'node:assert/strict';
import {incompleteExtras,type TorrentFile} from './qbittorrent';
import {connectivityProbeInterval,needsReplacementSearch,stalledDecision} from './policy';
import type {AcquisitionTarget,DownloadObservation} from './types';
import {retainMismatchedQueue} from './lidarr';
const files:TorrentFile[]=[{index:0,name:'01.mp3',size:1000,progress:1,priority:1},{index:1,name:'Folder.jpg',size:500,progress:.5,priority:1},{index:2,name:'Album.nfo',size:100,progress:0,priority:1}];
test('stalled replacements get one prompt search instead of waiting behind the migration backlog',()=>{
  assert.equal(needsReplacementSearch(JSON.stringify({reason:'No byte progress or reachable source for 4 hours'})),true);
  assert.equal(needsReplacementSearch(JSON.stringify({recoveryRetry:true})),true);
  assert.equal(needsReplacementSearch(JSON.stringify({reason:'No matching results in completed searches'})),false);
  assert.equal(needsReplacementSearch('{'),false);
});
test('a wrong box-set payload is retained without deletion, false import credit or global blocklisting',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{const u=new URL(String(input));assert.equal(init?.method,'DELETE');assert.equal(u.searchParams.get('removeFromClient'),'false');assert.equal(u.searchParams.get('blocklist'),'false');assert.equal(u.searchParams.get('changeCategory'),'false');return new Response(null,{status:204})};
  try{await retainMismatchedQueue({id:123})}finally{globalThis.fetch=original}
});
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
