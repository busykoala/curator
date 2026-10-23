import test from 'node:test';
import assert from 'node:assert/strict';
import {albumListeningHistory,listenerAlbumIdentity} from './album-listening-history';
import type {ListenerSong} from './listening-snapshot';
const song=(id:string,artist:string):ListenerSong=>({id,title:id,artist,album:'Compilation',albumId:'native-compilation',albumArtist:'Various Artists',playCount:0,hasPlayed:false,lastPlayed:null,favourite:false,rating:null,providerIds:{}});
test('native album identity joins compilation history across track artists',()=>{
  const heard={...song('heard','One'),hasPlayed:true,playCount:2,lastPlayed:'2026-10-22T12:00:00Z'},unheard=song('unheard','Two');
  assert.equal(albumListeningHistory([heard,unheard]).get(listenerAlbumIdentity(unheard))?.lastPlayed,heard.lastPlayed);
});
test('different native albums with identical names remain distinct',()=>{
  const heard={...song('heard','One'),hasPlayed:true,lastPlayed:'2026-10-22T12:00:00Z'},other={...song('other','One'),albumId:'different-native-album'};
  assert.equal(albumListeningHistory([heard,other]).get(listenerAlbumIdentity(other)),undefined);
});
test('album-artist fallback preserves compilation scope when native IDs are unavailable',()=>{
  const heard={...song('heard','One'),albumId:null,hasPlayed:true,lastPlayed:'2026-10-22T12:00:00Z'},other={...song('other','Two'),albumId:null};
  assert.equal(albumListeningHistory([heard,other]).get(listenerAlbumIdentity(other))?.lastPlayed,heard.lastPlayed);
});
test('undated plays remain uncertain while an unplayed favourite does not invent a play',()=>{
  const unknown={...song('unknown','One'),hasPlayed:true,playCount:4,lastPlayed:'invalid'},favourite={...song('favourite','Two'),favourite:true};
  assert.equal(albumListeningHistory([unknown]).get(listenerAlbumIdentity(unknown))?.undatedPlays,true);
  assert.equal(albumListeningHistory([favourite]).size,0);
  assert.equal(albumListeningHistory([{...unknown,lastPlayed:null}]).get(listenerAlbumIdentity(unknown))?.undatedPlays,true);
});
