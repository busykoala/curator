import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {provisionUser} from '@/features/auth/navidrome';
import {nativeOwnerPlaylists} from './navidrome';

const directory=mkdtempSync(join(tmpdir(),'curator-playlist-inventory-'));
config.DATABASE_PATH=join(directory,'test.sqlite');
const database=db(),owner=provisionUser({token:'test',navidromeUserId:'owner',username:'owner',displayName:'Owner'}),originalFetch=globalThis.fetch;
test('native inventory follows server-sized pages and refuses an incomplete or unstable inventory',async()=>{
  const offsets:number[]=[];
  globalThis.fetch=async input=>{
    const query=new URL(String(input)).searchParams,offset=Number(query.get('StartIndex'));offsets.push(offset);
    assert.equal(query.get('Limit'),'500');
    return Response.json({Items:[{Id:String(offset)}],TotalRecordCount:3});
  };
  assert.deepEqual((await nativeOwnerPlaylists(owner.id)).map(item=>item.Id),['0','1','2']);assert.deepEqual(offsets,[0,1,2]);
  globalThis.fetch=async input=>Response.json({Items:Number(new URL(String(input)).searchParams.get('StartIndex'))?[]:[{Id:'one'}],TotalRecordCount:2});
  await assert.rejects(nativeOwnerPlaylists(owner.id),/incomplete/);
  globalThis.fetch=async()=>Response.json({Items:[{Id:'repeated'}],TotalRecordCount:2});
  await assert.rejects(nativeOwnerPlaylists(owner.id),/repeated/);
  globalThis.fetch=async input=>Response.json({Items:[{Id:new URL(String(input)).searchParams.get('StartIndex')}],TotalRecordCount:Number(new URL(String(input)).searchParams.get('StartIndex'))?3:2});
  await assert.rejects(nativeOwnerPlaylists(owner.id),/changed/);
  globalThis.fetch=async()=>Response.json({Items:[{Id:'one'},{Id:'two'}],TotalRecordCount:1});
  await assert.rejects(nativeOwnerPlaylists(owner.id),/declared count/);
});
test.after(()=>{globalThis.fetch=originalFetch;database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
