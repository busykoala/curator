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
test.after(()=>{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
