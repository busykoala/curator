import test from 'node:test';
import assert from 'node:assert/strict';
import {helperFolders,validateHelperImport} from './import-guard';
const file={path:'/data/downloads/Album/01.flac',downloadId:'abc',artistId:2,albumId:3,albumReleaseId:4,trackIds:[5]};
const queue=[{downloadId:'ABC',albumId:3,artistId:2,status:'completed',sizeleft:0}];
const rows=[{path:file.path,artist:{id:2},album:{id:3},albumReleaseId:4,tracks:[{id:5}],rejections:[]}];
test('helper imports require completed downloads and fresh unique album/track mappings',()=>{
  const command={name:'ManualImport',files:[file]};
  assert.equal(validateHelperImport(command,queue,rows),true);
  assert.equal(validateHelperImport(command,[{...queue[0],status:'downloading'}],rows),false);
  assert.equal(validateHelperImport(command,queue,[{...rows[0],rejections:['Wrong album']}]),false);
  assert.equal(validateHelperImport(command,queue,[{...rows[0],tracks:[{id:5},{id:6}]}]),false);
  assert.equal(validateHelperImport({...command,files:[file,file]},queue,rows),false);
  assert.equal(validateHelperImport({...command,files:[{...file,albumId:99}]},queue,rows),false);
  assert.equal(validateHelperImport({...command,files:[{...file,path:'/data/downloads/../library/file.flac'}]},queue,rows),false);
});
test('archive directory aliases are limited to the same download basename',()=>{
  assert.deepEqual(helperFolders('/data/downloads/Album.7z'),['/data/downloads/Album.7z','/data/downloads/Album']);
  assert.deepEqual(helperFolders('/data/downloads/Album'),['/data/downloads/Album']);
  assert.deepEqual(helperFolders('/data/downloads/../library'),[]);
  assert.deepEqual(helperFolders('/data/library/Album.7z'),[]);
});
