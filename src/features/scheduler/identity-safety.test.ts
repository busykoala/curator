import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {processAlbums} from './process';
test('unidentified albums do not query providers, call AI, write tags or copy artwork',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'curator-identity-safe-'));config.DATABASE_PATH=join(dir,'test.sqlite');
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Unidentified files must not query providers')};
 try{
  db().prepare("INSERT INTO files(path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json) VALUES('/music/raw/file.flac','unknown','Unknown Artist','Unknown Album','flac',1,1,1,1,'{}','{}','[]')").run();
  const result=await processAlbums();assert.equal(result.written,0);assert.equal(calls,0);
  assert.equal((db().prepare('SELECT status FROM files').get() as {status:string}).status,'error');
  assert.equal((db().prepare("SELECT count(*) n FROM issues WHERE code='identity_unresolved' AND status='open'").get() as {n:number}).n,1);
 }finally{globalThis.fetch=original;db().close();rmSync(dir,{recursive:true,force:true})}
});
