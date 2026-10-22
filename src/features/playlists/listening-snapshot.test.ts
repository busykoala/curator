import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {listenerMusicSnapshot} from './listening-snapshot';
const directory=mkdtempSync(join(tmpdir(),'curator-listening-'));config.DATABASE_PATH=join(directory,'test.sqlite');const database=db();
database.exec("INSERT INTO curator_users(id,navidrome_user_id,username,display_name) VALUES(1,'one','one','One'),(2,'two','two','Two')");
test.beforeEach(()=>database.exec('DELETE FROM listener_music_snapshots'));
test('complete pagination retains song identities and favourites beyond the old 500-song limit',async()=>{
  const offsets:number[]=[];
  const songs=Array.from({length:1001},(_,i)=>({Id:String(i),Name:'Song '+i,Artists:['Artist'],Album:'Album',UserData:{PlayCount:i,LastPlayedDate:'2026-01-01T00:00:00Z',IsFavorite:i===1000,Rating:4}}));
  const snapshot=await listenerMusicSnapshot(1,{load:async path=>{const offset=Number(new URLSearchParams(path.split('?')[1]).get('StartIndex'));offsets.push(offset);return{Items:songs.slice(offset,offset+500),TotalRecordCount:songs.length}}});
  assert.equal(snapshot.complete,true);assert.equal(snapshot.stale,false);assert.equal(snapshot.songs.length,1001);
  assert.deepEqual(offsets,[0,500,1000]);assert.equal(snapshot.songs.at(-1)?.favourite,true);assert.equal(snapshot.songs.at(-1)?.id,'1000');
  const cached=await listenerMusicSnapshot(1,{load:async()=>{throw Error('Cache should prevent the request')}});assert.equal(cached.stale,false);
});
test('a failed or inconsistent refresh retains the last complete snapshot',async()=>{
  const old=Date.now()-2*3600000;
  await listenerMusicSnapshot(1,{now:old,load:async()=>({Items:[{Id:'known',UserData:{PlayCount:10}}],TotalRecordCount:1})});
  const stale=await listenerMusicSnapshot(1,{load:async()=>{throw Error('Service unavailable')}});
  assert.equal(stale.complete,true);assert.equal(stale.stale,true);assert.equal(stale.songs[0].id,'known');assert.match(stale.error,/unavailable/);
  const empty=await listenerMusicSnapshot(2,{load:async()=>{throw Error('Service unavailable')}});
  assert.equal(empty.available,false);assert.equal(empty.complete,false);assert.deepEqual(empty.songs,[]);
});
test('repeated pages, missing counts and changing library size cannot prove unheard status',async()=>{
  const repeated=Array.from({length:500},(_,i)=>({Id:String(i)}));
  const duplicate=await listenerMusicSnapshot(1,{load:async()=>({Items:repeated,TotalRecordCount:1000})});
  assert.equal(duplicate.complete,false);assert.match(duplicate.error,/repeated/);
  const missing=await listenerMusicSnapshot(2,{load:async()=>({Items:[]})});
  assert.equal(missing.complete,false);assert.match(missing.error,/trustworthy total/);
});
test('snapshots and failures remain scoped to their owner',async()=>{
  await listenerMusicSnapshot(1,{load:async()=>({Items:[{Id:'private-one',UserData:{IsFavorite:true}}],TotalRecordCount:1})});
  const other=await listenerMusicSnapshot(2,{load:async()=>({Items:[{Id:'private-two'}],TotalRecordCount:1})});
  assert.deepEqual(other.songs.map(s=>s.id),['private-two']);
  assert.deepEqual((await listenerMusicSnapshot(1)).songs.map(s=>s.id),['private-one']);
});
test.after(()=>{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
