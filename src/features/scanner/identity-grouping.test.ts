import test from 'node:test';
import assert from 'node:assert/strict';
import {scannedAlbumKey,hasIdentityContext} from './normalize';
test('unidentified albums in different folders cannot share enrichment or artwork',()=>{
 assert.notEqual(scannedAlbumKey('Unknown Artist','Unknown Album','/music/Jimi Hendrix/War Heroes'),scannedAlbumKey('Unknown Artist','Unknown Album','/music/The Zombies/Odessey'));
 assert.notEqual(scannedAlbumKey('Artist','Unknown Album','/music/Artist/One'),scannedAlbumKey('Artist','Unknown Album','/music/Artist/Two'));
 assert.equal(hasIdentityContext('Unknown Artist','Unknown Album'),false);
 assert.equal(scannedAlbumKey('Artist','Album','/one'),scannedAlbumKey('Artist','Album','/two'));
});
