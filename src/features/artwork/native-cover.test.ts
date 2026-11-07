import test from 'node:test';
import assert from 'node:assert/strict';
import {mappedNativeAlbumId} from './native-cover';
const files=[{path:'/music/Artist/Album/01.flac'},{path:'/music/Artist/Album/02.flac'}];
const native=(albumId:number,path:string)=>({albumId,path:'/data/library/'+path});
test('exact file mapping selects a unique native album even when a target points at another edition',()=>{
 const nativeFiles=[native(1,'Other/01.flac'),native(2,'Artist/Album/01.flac'),native(2,'Artist/Album/02.flac')];
 assert.equal(mappedNativeAlbumId(files,nativeFiles,'/music','/data/library'),2);
});
test('partial, ambiguous and empty mappings are not identity evidence',()=>{
 assert.equal(mappedNativeAlbumId(files,[native(2,'Artist/Album/01.flac')],'/music','/data/library'),undefined);
 assert.equal(mappedNativeAlbumId(files,[...files.flatMap(f=>[native(2,f.path.slice(7)),native(3,f.path.slice(7))])],'/music','/data/library'),undefined);
 assert.equal(mappedNativeAlbumId([],[],'/music','/data/library'),undefined);
});
