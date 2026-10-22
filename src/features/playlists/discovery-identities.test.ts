import test from 'node:test';
import assert from 'node:assert/strict';
import {recommendedAlbumGroup,radioRecordings} from './discovery-identities';
const recording='11111111-1111-4111-8111-111111111111',artist='22222222-2222-4222-8222-222222222222',group='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444';
const release=(id:string,types:string[]=[],date='2000')=>({id,date,status:'Official','release-group':{id,title:'Album','primary-type':'Album','secondary-types':types}});
const base={id:recording,title:'Recommended song','artist-credit':[{artist:{id:artist,name:'Artist'}}]};
test('recording recommendations resolve an artist album rather than the first matching compilation',()=>{
  assert.equal(recommendedAlbumGroup({...base,releases:[release(other,['Compilation'],'1990'),release(group,[],'2000')]},recording,artist),group);
  assert.equal(recommendedAlbumGroup({...base,releases:[release(other,['Compilation'])]},recording,artist),null);
  assert.equal(recommendedAlbumGroup({...base,releases:[release(other,['Live'],'1990'),release(group,[],'2000')]},recording,artist),group);
});
test('recording and artist identities must match the recommendation before resolving its release',()=>{
  assert.equal(recommendedAlbumGroup({...base,releases:[release(group)]},other,artist),null);
  assert.equal(recommendedAlbumGroup({...base,releases:[release(group)]},recording,other),null);
  assert.equal(recommendedAlbumGroup({...base,releases:[{...release(group),status:'Bootleg'}]},recording,artist),null);
  assert.equal(recommendedAlbumGroup({...base,releases:[{...release(other),status:null,date:null},release(group)]},recording,artist),group,'A legitimate unknown release status cannot poison the other official editions');
  assert.throws(()=>recommendedAlbumGroup({id:recording},recording,artist));
});
test('malformed radio payloads are errors rather than a cached empty recommendation result',()=>{
  assert.throws(()=>radioRecordings.parse({payload:{error:'Unavailable'}}));
  assert.throws(()=>radioRecordings.parse({[artist]:[{recording_mbid:'bad-id',similar_artist_mbid:artist,similar_artist_name:'Artist'}]}));
  assert.deepEqual(radioRecordings.parse({}),{});
});
