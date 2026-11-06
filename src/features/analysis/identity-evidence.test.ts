import test from 'node:test';
import assert from 'node:assert/strict';
import {albumHasConsistentIdentity} from './identity-evidence';
const a='aef01a53-9692-395e-bb0a-6c5c0ccae7e0',b='75f41eef-740e-4fb2-923b-8e4ea8449515';
test('one identified track cannot hide unresolved files or mixed album identities',()=>{
 assert.equal(albumHasConsistentIdentity([{musicbrainzReleaseGroupId:a},{}]),false);
 assert.equal(albumHasConsistentIdentity([{musicbrainzReleaseGroupId:a},{musicbrainzReleaseGroupId:b}]),false);
 assert.equal(albumHasConsistentIdentity([{musicbrainzReleaseGroupId:'unresolved'}]),false);
 assert.equal(albumHasConsistentIdentity([]),false);
});
test('complete, consistent IDs work with native and typed tag names',()=>{
 assert.equal(albumHasConsistentIdentity([{musicbrainzReleaseGroupId:a},{extraProperties:{MUSICBRAINZ_RELEASEGROUPID:[a.toUpperCase()]}}]),true);
 assert.equal(albumHasConsistentIdentity([{musicbrainzReleaseGroupId:a,extraProperties:{MUSICBRAINZ_RELEASEGROUPID:[b]}}]),false);
});
