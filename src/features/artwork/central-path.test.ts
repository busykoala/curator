import test from 'node:test';
import assert from 'node:assert/strict';
import {config} from '@/config';
import {centralArtistPath} from './manager';
test('central artist image names avoid characters the exFAT library rejects',()=>{
  assert.equal(centralArtistPath('*NSYNC'),`${config.MUSIC_ROOT}/.artist-images/_NSYNC.jpg`);
  assert.equal(centralArtistPath('*NSYNC feat. Lisa "Left Eye" Lopes'),`${config.MUSIC_ROOT}/.artist-images/_NSYNC feat. Lisa _Left Eye_ Lopes.jpg`);
  assert.equal(centralArtistPath('AC/DC'),`${config.MUSIC_ROOT}/.artist-images/AC_DC.jpg`);
  assert.equal(centralArtistPath('Graupe-Brendle-Terzic'),`${config.MUSIC_ROOT}/.artist-images/Graupe-Brendle-Terzic.jpg`);
  assert.equal(centralArtistPath(' '),undefined);
  assert.equal(centralArtistPath('..'),undefined);
});
