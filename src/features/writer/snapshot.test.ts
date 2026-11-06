import test from 'node:test';
import assert from 'node:assert/strict';
import {tagSnapshot} from './snapshot';
test('a verified identity write replaces stale typed, raw and extra-property IDs together',()=>{
 const tags=JSON.parse(tagSnapshot(JSON.stringify({title:'Song',musicbrainzReleaseGroupId:'old',MUSICBRAINZ_RELEASEGROUPID:['old'],extraProperties:{MUSICBRAINZ_RELEASEGROUPID:['old'],ISRC:['retained']}}),{MUSICBRAINZ_RELEASEGROUPID:['verified']}));
 assert.equal(tags.musicbrainzReleaseGroupId,'verified');assert.equal(tags.MUSICBRAINZ_RELEASEGROUPID,undefined);assert.deepEqual(tags.extraProperties,{ISRC:['retained'],MUSICBRAINZ_RELEASEGROUPID:['verified']});assert.equal(tags.title,'Song');
});
test('removed tags cannot survive in the database as alternate aliases',()=>{
 const tags=JSON.parse(tagSnapshot(JSON.stringify({musicbrainzReleaseGroupId:'old',MUSICBRAINZ_RELEASEGROUPID:'old',extraProperties:{MUSICBRAINZ_RELEASEGROUPID:['old']},composer:['kept']}),{MUSICBRAINZ_RELEASEGROUPID:[]}));
 assert.equal(tags.musicbrainzReleaseGroupId,undefined);assert.equal(tags.MUSICBRAINZ_RELEASEGROUPID,undefined);assert.equal(tags.extraProperties,undefined);assert.deepEqual(tags.composer,['kept']);
});
test('dates and enrichment evidence reflect the write without replacing unrelated user tags',()=>{
 const tags=JSON.parse(tagSnapshot(JSON.stringify({date:'1999',year:1999,comment:'Personal note',extraProperties:{CUSTOM:['Mine']}}),{DATE:['2001-06-08'],INSTRUMENTATION:['piano'],ARTISTDESCRIPTION:['Verified credit'],AUTHOR:[]}));
 assert.equal(tags.date,'2001-06-08');assert.equal(tags.year,2001);assert.equal(tags.comment,'Personal note');assert.equal(tags.INSTRUMENTATION,'piano');assert.deepEqual(tags.extraProperties.CUSTOM,['Mine']);assert.deepEqual(tags.extraProperties.ARTISTDESCRIPTION,['Verified credit']);assert.equal(tags.AUTHOR,undefined);
});
