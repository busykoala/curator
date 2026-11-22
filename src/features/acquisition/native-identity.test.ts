import test from 'node:test';
import assert from 'node:assert/strict';
import {discBaseName,planNativeConfirmation,type LocalFile} from './native-identity';
import type {ReleaseTrack} from './import-proof';

const group='48ec720b-2fc2-35dd-8130-5b186c4abcbc';
const track=(id:number,fileId:number,duration:number,medium=1):ReleaseTrack=>({id,albumId:7,artistId:1,title:`T${id}`,duration,absoluteTrackNumber:id,mediumNumber:medium,hasFile:true,trackFileId:fileId});
const local=(n:number,key='a',name='Album',durationMs=200_000):LocalFile=>({path:`/music/Artist/Album/${n}.flac`,album_key:key,artist_name:'Artist',album_name:name,durationMs});
const native=(n:number,albumId=7)=>({id:100+n,albumId,path:`/data/library/Artist/Album/${n}.flac`});
const albumInfo={id:7,title:'Album',foreignAlbumId:group,percentOfTracks:100};

test('exact native mapping with agreeing durations confirms the release group',()=>{
  const plan=planNativeConfirmation({files:[local(1),local(2)],native:[native(1),native(2)],tracks:[track(1,101,201_000),track(2,102,198_500)],album:albumInfo});
  assert.deepEqual(plan,{releaseGroupId:group,albumName:'Album',split:false,albums:[{albumKey:'a',artistName:'Artist'}]});
});

test('weak or conflicting evidence is rejected',()=>{
  const files=[local(1),local(2)],nat=[native(1),native(2)],tracks=[track(1,101,200_000),track(2,102,200_000)];
  assert.ok('rejected' in planNativeConfirmation({files,native:nat,tracks:[tracks[0]],album:albumInfo}),'track count must match');
  assert.ok('rejected' in planNativeConfirmation({files,native:[native(1)],tracks,album:albumInfo}),'every file must be mapped');
  assert.ok('rejected' in planNativeConfirmation({files,native:[native(1),native(2,8)],tracks,album:albumInfo}),'files must map to this album');
  assert.ok('rejected' in planNativeConfirmation({files,native:nat,tracks:[track(1,101,200_000),track(2,102,206_000)],album:albumInfo}),'durations within 5 s');
  assert.ok('rejected' in planNativeConfirmation({files,native:nat,tracks,album:{...albumInfo,percentOfTracks:90}}),'complete album only');
  assert.ok('rejected' in planNativeConfirmation({files,native:nat,tracks,album:{...albumInfo,foreignAlbumId:'not-a-uuid'}}),'needs a release group');
  assert.ok('rejected' in planNativeConfirmation({files:[{...local(1),durationMs:null},local(2)],native:nat,tracks,album:albumInfo}),'needs measured durations');
});

test('disc-split albums are merged under one name',()=>{
  const files=[local(1,'cd1','Blue Train: The Complete Masters CD1'),local(2,'cd2','Blue Train: The Complete Masters CD2')];
  const plan=planNativeConfirmation({files,native:[native(1),native(2)],tracks:[track(1,101,200_000),track(2,102,200_000,2)],album:{...albumInfo,title:'Blue Train'}});
  assert.ok(!('rejected' in plan));
  assert.equal(plan.split,true);assert.equal(plan.albumName,'Blue Train: The Complete Masters');assert.equal(plan.albums.length,2);
});

test('disc suffixes are stripped conservatively',()=>{
  assert.equal(discBaseName('Hotel California CD1'),'Hotel California');
  assert.equal(discBaseName('The Complete Greatest Hits (disc 2)'),'The Complete Greatest Hits');
  assert.equal(discBaseName('An Anthology, Vol I [CD 02]'),'An Anthology, Vol I');
  assert.equal(discBaseName('Part 2'),'Part 2');
  assert.equal(discBaseName('Discovery'),'Discovery');
});
