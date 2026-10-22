import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {createPlaylist} from './repository';
import {publishVerifiedPlaylist,type PublicationAdapter} from './publication';

const directory=mkdtempSync(join(tmpdir(),'curator-publication-'));config.DATABASE_PATH=join(directory,'test.sqlite');
const database=db();database.exec("INSERT INTO curator_users(id,navidrome_user_id,username,display_name) VALUES(1,'one','one','One')");
function fixture(){
  const p=createPlaylist({name:'Mix '+Math.random(),category:'mood',ownerUserId:1,config:{targetTracks:2}});
  const native=new Map<string,{name:string;ids:string[]}>();let creates=0,writes=0;
  const adapter:PublicationAdapter={list:async()=>[...native].map(([id,p])=>({id,name:p.name})),items:async id=>{const p=native.get(id);if(!p)throw Error('Missing playlist');return p.ids.slice()},
    create:async(name,ids)=>{const id='new-'+(++creates);native.set(id,{name,ids:ids.slice()});return id},
    update:async(id,name,ids)=>{writes++;native.set(id,{name,ids:ids.slice()})}};
  return{p,native,adapter,counts:()=>({creates,writes})};
}
test('a lost create response recovers exactly one native playlist by journal identity',async()=>{
  const f=fixture(),create=f.adapter.create;
  f.adapter.create=async(name,ids)=>{await create(name,ids);throw Error('Connection lost after create')};
  await assert.rejects(publishVerifiedPlaylist(f.p,['a','b'],undefined,f.adapter,()=>{}),/Connection lost/);
  assert.equal(f.native.size,1);
  f.adapter.create=create;
  const result=await publishVerifiedPlaylist(f.p,['a','b'],undefined,f.adapter,()=>{});
  assert.equal(f.counts().creates,1);assert.equal(f.native.get(result.playlistId)?.name,f.p.name);
  await publishVerifiedPlaylist(f.p,['a','b'],result.playlistId,f.adapter,()=>{});
  assert.deepEqual(f.counts(),{creates:1,writes:1});
});
test('verification failure restores the last native selection',async()=>{
  const f=fixture();f.native.set('existing',{name:f.p.name,ids:['old-a','old-b']});
  const update=f.adapter.update;let corrupt=true;
  f.adapter.update=async(id,name,ids)=>{await update(id,name,corrupt?ids.slice(0,1):ids);corrupt=false};
  await assert.rejects(publishVerifiedPlaylist(f.p,['a','b'],'existing',f.adapter,()=>{}),/verification failed/);
  assert.deepEqual(f.native.get('existing')?.ids,['old-a','old-b']);
  await publishVerifiedPlaylist(f.p,['a','b'],'existing',f.adapter,()=>{});
  assert.deepEqual(f.native.get('existing')?.ids,['a','b']);
});
test('a revision change during native mutation is fenced and rolled back',async()=>{
  const f=fixture();f.native.set('existing',{name:f.p.name,ids:['old']});let valid=true;
  const update=f.adapter.update;f.adapter.update=async(...args)=>{await update(...args);valid=false};
  await assert.rejects(publishVerifiedPlaylist(f.p,['a'],'existing',f.adapter,()=>{if(!valid)throw Error('Playlist settings changed; superseded')}),/superseded/);
  assert.deepEqual(f.native.get('existing')?.ids,['old']);
});
test('empty and duplicate selections cannot touch the native API',async()=>{
  const f=fixture();
  for(const ids of [[],['a','a']])await assert.rejects(publishVerifiedPlaylist(f.p,ids,undefined,f.adapter,()=>{}),/empty or duplicate/);
  assert.equal(f.native.size,0);
});
test('a newer configuration adopts a lost-response create instead of creating a second native playlist',async()=>{
  const f=fixture(),create=f.adapter.create;
  f.adapter.create=async(name,ids)=>{await create(name,ids);throw Error('Lost create response')};
  await assert.rejects(publishVerifiedPlaylist(f.p,['old'],undefined,f.adapter,()=>{}),/Lost create/);
  f.adapter.create=create;
  const changed={...f.p,name:'New direction',revision:(f.p.revision??1)+1};
  const result=await publishVerifiedPlaylist(changed,['new-a','new-b'],undefined,f.adapter,()=>{});
  assert.equal(f.native.size,1);assert.equal(f.counts().creates,1);assert.equal(f.native.get(result.playlistId)?.name,changed.name);assert.deepEqual(f.native.get(result.playlistId)?.ids,['new-a','new-b']);
  assert.equal((database.prepare('SELECT status FROM playlist_publications WHERE playlist_id=? ORDER BY rowid LIMIT 1').get(f.p.id) as {status:string}).status,'superseded');
});
test('renaming a playlist with unchanged songs still updates the remote name and a failed rename restores it',async()=>{
  const f=fixture();f.native.set('existing',{name:'Previous name',ids:['a','b']});
  const changed={...f.p,name:'Changed name'};
  await publishVerifiedPlaylist(changed,['a','b'],'existing',f.adapter,()=>{});assert.equal(f.native.get('existing')?.name,changed.name);assert.equal(f.counts().writes,1);
  f.adapter.verify=async()=>['wrong'];
  await assert.rejects(publishVerifiedPlaylist({...changed,revision:(changed.revision??1)+1,name:'Failed rename'},['a','b'],'existing',f.adapter,()=>{}),/verification failed/);
  assert.equal(f.native.get('existing')?.name,changed.name);assert.deepEqual(f.native.get('existing')?.ids,['a','b']);
});
test('an unverified new playlist remains a recoverable pending draft rather than a named published mix',async()=>{
  const f=fixture();f.adapter.verify=async()=>['wrong'];
  await assert.rejects(publishVerifiedPlaylist(f.p,['a','b'],undefined,f.adapter,()=>{}),/verification failed/);
  assert.equal(f.native.size,1);assert.ok([...f.native.values()][0].name.startsWith('Curator pending '));
  delete f.adapter.verify;
  const result=await publishVerifiedPlaylist(f.p,['a','b'],undefined,f.adapter,()=>{});assert.equal(f.native.size,1);assert.equal(f.counts().creates,1);assert.equal(f.native.get(result.playlistId)?.name,f.p.name);
});
test('a stale worker cannot roll back a newer selection or overwrite the successor journal',async()=>{
  const f=fixture();f.native.set('existing',{name:f.p.name,ids:['old']});let owned=true;
  const update=f.adapter.update;
  f.adapter.update=async(...args)=>{await update(...args);owned=false;f.native.set('existing',{name:'Newer publication',ids:['newer']})};
  await assert.rejects(publishVerifiedPlaylist(f.p,['a','b'],'existing',f.adapter,()=>{if(!owned)throw Error('Lease expired')},()=>{if(!owned)throw Error('Lease expired')}));
  assert.deepEqual(f.native.get('existing')?.ids,['newer']);assert.equal(f.counts().writes,1);
  assert.notEqual((database.prepare('SELECT status FROM playlist_publications WHERE playlist_id=?').get(f.p.id) as {status:string}).status,'rolled_back');
});
test('a deleted remote playlist is recreated once and multiple known native identities fail safely',async()=>{
  const f=fixture(),first=await publishVerifiedPlaylist(f.p,['a','b'],undefined,f.adapter,()=>{});f.native.delete(first.playlistId);
  const replacement=await publishVerifiedPlaylist(f.p,['a','b'],undefined,f.adapter,()=>{});assert.notEqual(replacement.playlistId,first.playlistId);assert.equal(f.native.size,1);
  const prior=database.prepare('SELECT id FROM playlist_publications WHERE playlist_id=?').get(f.p.id) as {id:string};
  f.native.set('duplicate',{name:`Curator pending ${f.p.id} ${prior.id}`,ids:['a','b']});
  await assert.rejects(publishVerifiedPlaylist({...f.p,revision:(f.p.revision??1)+1},['c'],undefined,f.adapter,()=>{}),/Multiple native playlists/);assert.equal(f.counts().creates,2);
});
test.after(()=>{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
