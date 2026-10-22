import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {musicalFitRubric,playlistIntentCases} from './evaluation-cases';
const {summarizeRuns,fixedMetadataSample}=createRequire(import.meta.url)('../../../scripts/audit-playlists.cjs');

test('fixed evaluations cover all types with distinct reference criteria',()=>{
  assert.equal(playlistIntentCases.length,24);assert.equal(musicalFitRubric.length,40);
  assert.equal(new Set(playlistIntentCases.map(x=>x.category)).size,6);
  assert.equal(new Set(musicalFitRubric.map(x=>x.id)).size,40);
  assert.ok(musicalFitRubric.every(x=>x.positive!==x.negative&&x.criterion));
});

test('baseline separates previews and failures from published changes',()=>{
  const runs=[{id:1,status:'complete',preview:0,finished_at:'day1'},{id:2,status:'complete',preview:1},{id:3,status:'failed',preview:0},{id:4,status:'complete',preview:0,finished_at:'day2'}];
  const items=[{run_id:1,file_id:1,artist_name:'A',album_name:'A',title:'one',navidrome_song_id:'a'},
    {run_id:2,file_id:99},{run_id:4,file_id:1,artist_name:'A',album_name:'A',title:'one',navidrome_song_id:'a'},
    {run_id:4,file_id:2,artist_name:'B',album_name:'B',title:'two',navidrome_song_id:'b'}];
  const report=summarizeRuns(runs,items);
  assert.equal(report.successfulPublications,2);assert.equal(report.uniqueSongs,2);
  assert.deepEqual(report.transitions,[{runId:4,at:'day2',songs:2,added:1,retained:1}]);
});
test('fixed metadata audit is deterministic, unique and covers difficult strata',()=>{
  const tracks=Array.from({length:200},(_,i)=>({fileId:i+1,title:i===0?'東京':'Song',artist:i===1?'Various Artists':'Artist',album:'Album',profile:{genre:i%2?['jazz']:['rock'],energy:i%2?'high':'low',recordingTypes:i%3?[]:['live'],vocalProfile:['instrumental']}}));
  const sample=fixedMetadataSample(tracks);
  assert.equal(sample.length,120);assert.equal(new Set(sample.map((t:{fileId:number})=>t.fileId)).size,120);
  assert.deepEqual(sample,fixedMetadataSample(tracks.slice().reverse()));
  assert.ok(sample.some((t:{strata:string[]})=>t.strata.includes('non_latin')));
});
