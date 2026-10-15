import test from 'node:test';
import assert from 'node:assert/strict';
import {config} from '@/config';
import {rescanFolders} from './lidarr';
test('rescan notifications use Lidarr mount paths and refuse folders outside the library',async()=>{
  const fetch=globalThis.fetch,key=config.LIDARR_API_KEY;config.LIDARR_API_KEY='rescan-test-key';let commands=0;
  globalThis.fetch=async(_url,init)=>{assert.deepEqual(JSON.parse(String(init?.body)),{name:'RescanFolders',folders:['/data/library/Green Day/¡Uno! (2012)']});commands++;return Response.json({id:1})};
  try{await rescanFolders(['/music/Green Day/¡Uno! (2012)','/music/Green Day/¡Uno! (2012)']);assert.equal(commands,1);await assert.rejects(rescanFolders(['/music-other/Album']),/outside/);assert.equal(commands,1)}finally{globalThis.fetch=fetch;config.LIDARR_API_KEY=key}
});
