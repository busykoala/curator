import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,link,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {config} from '@/config';
import {identityRepairPlan,libraryImportPath,missingIdentityProperties,repairImportedFile,importedEditionIdentity} from './imported-identity';
test('edition identities require complete native UUIDs bound to the proven artist and album',()=>{
 const group='11111111-1111-4111-8111-111111111111',release='22222222-2222-4222-8222-222222222222',recording='33333333-3333-4333-8333-333333333333',releaseTrack='44444444-4444-4444-8444-444444444444';
 const a={id:10,artistId:20,title:'Album',monitored:true,foreignAlbumId:group,releases:[{id:30,title:'Album',foreignReleaseId:release}]};
 const track={id:40,albumId:10,artistId:20,title:'Song',duration:180000,absoluteTrackNumber:1,mediumNumber:1,foreignRecordingId:recording,foreignTrackId:releaseTrack};
 const ids=importedEditionIdentity(a,30,track);
 assert.deepEqual(ids,{MUSICBRAINZ_ALBUMID:release,MUSICBRAINZ_RELEASEGROUPID:group,MUSICBRAINZ_RELEASETRACKID:releaseTrack,MUSICBRAINZ_TRACKID:recording});
 assert.deepEqual(importedEditionIdentity(a,31,track),{});
 assert.deepEqual(importedEditionIdentity(a,30,{...track,albumId:11}),{});
 assert.deepEqual(importedEditionIdentity(a,30,{...track,artistId:21}),{});
 assert.deepEqual(importedEditionIdentity(a,30,{...track,foreignRecordingId:'unverified'}),{});
 assert.equal(missingIdentityProperties({MUSICBRAINZ_ALBUMID:['existing-user-value']},ids).MUSICBRAINZ_ALBUMID,undefined);
});
test('verified imports undo only the exact wrong identity generated from unidentified source tags',()=>{
 const expected={ARTIST:'Jimi Hendrix',ALBUMARTIST:'Jimi Hendrix',ALBUM:'War Heroes',TITLE:'Bleeding Heart',DATE:'1972-10-01'};
 const tags={ARTIST:['Shinedown'],ALBUM:['Leave a Whisper'],GENRE:['Rock']};
 const plan=identityRepairPlan(tags,expected,{artist:'Shinedown',album:'Leave a Whisper'});
 assert.equal(plan.restore,true);assert.deepEqual(plan.properties.ARTIST,['Jimi Hendrix']);assert.deepEqual(plan.properties.ALBUM,['War Heroes']);assert.deepEqual(plan.properties.GENRE,[]);assert.deepEqual(plan.properties.DATE,['1972-10-01']);
 assert.equal(identityRepairPlan({...tags,ARTIST:['Manual Edit']},expected,{artist:'Shinedown',album:'Leave a Whisper'}).restore,false);
 assert.equal(identityRepairPlan(tags,expected).restore,false);
});
test('identity repair only fills missing fields, preserving existing metadata',()=>{
  assert.deepEqual(missingIdentityProperties({ARTIST:['Existing Artist'],TRACKNUMBER:'0'},{ARTIST:'Artist',ALBUM:'Album',TRACKNUMBER:'1'}),{ALBUM:['Album'],TRACKNUMBER:['1']});
  assert.throws(()=>libraryImportPath('/data/downloads/test.flac'),/outside/);
  assert.throws(()=>libraryImportPath('/data/library/../downloads/test.flac'),/outside/);
});
test('transactional library metadata repair preserves hardlinked torrent originals and rejects escaped paths',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'curator-library-tags-')),root=join(dir,'library'),original=join(dir,'original.flac');
  const beforeRoot=config.MUSIC_ROOT;config.MUSIC_ROOT=root;
  try{
    await mkdir(root);await writeFile(original,'original audio');const library=join(root,'song.flac');await link(original,library);
    let properties:Record<string,string[]>={};
    const io={read:async()=>({ARTIST:['Existing Artist']}),write:async(path:string,p:Record<string,string[]>)=>{properties=p;await writeFile(path,'audio with metadata')}};
    assert.equal(await repairImportedFile(library,{ARTIST:'Canonical Artist',ALBUM:'Album'},io),true);
    assert.deepEqual(properties,{ALBUM:['Album']});assert.equal(await readFile(original,'utf8'),'original audio');assert.equal(await readFile(library,'utf8'),'audio with metadata');
    const escaped=join(root,'escape.flac');await symlink(original,escaped);
    await assert.rejects(repairImportedFile(escaped,{ALBUM:'Album'},io),/outside/);
    await assert.rejects(repairImportedFile(library,{ALBUM:'Album'},{...io,write:async()=>{throw Error('Write failed')}}),/Write failed/);
    assert.equal(await readFile(library,'utf8'),'audio with metadata');
    await assert.rejects(repairImportedFile(library,{ALBUM:'Album'},{...io,write:async path=>{await writeFile(path,'replacement');await writeFile(library,'concurrent edit')}}),/changed/);
    assert.equal(await readFile(library,'utf8'),'concurrent edit');
  }finally{config.MUSIC_ROOT=beforeRoot;await rm(dir,{recursive:true,force:true})}
});
