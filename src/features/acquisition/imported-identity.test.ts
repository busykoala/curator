import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,link,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {config} from '@/config';
import {identityRepairPlan,libraryImportPath,missingIdentityProperties,repairImportedFile} from './imported-identity';
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
