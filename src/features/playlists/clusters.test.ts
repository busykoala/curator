import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {config} from '@/config';import {db} from '@/features/db/client';import {provisionUser} from '@/features/auth/navidrome';
import {refreshListeningClusters} from './clusters';
const directory=mkdtempSync(join(tmpdir(),'curator-cluster-history-'));config.DATABASE_PATH=join(directory,'db.sqlite');const database=db();
const user=provisionUser({token:'fixture-only',navidromeUserId:'one',username:'one',displayName:'One'}),original=globalThis.fetch;
test('taste clusters preserve Unicode artist and album identities',async()=>{
  database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES(1,'/music/one','album','坂本龍一','静かな朝','flac',1,1,1,1,'{}','{}','{}','written')").run();
  database.prepare("INSERT INTO album_profiles(album_key,profile_json,track_profile_hash,schema_version,classifier_version) VALUES('album','{\"genre\":[\"ambient\"],\"style\":[\"neoclassical\"]}','fixture',1,1)").run();
  globalThis.fetch=async()=>Response.json({Items:[{Id:'native-one',Name:'曲',Artists:['坂本龍一'],Album:'静かな朝',UserData:{Played:true,PlayCount:4}}],TotalRecordCount:1});
  assert.equal(await refreshListeningClusters(user.id),2);
  assert.deepEqual((database.prepare('SELECT label FROM listening_clusters ORDER BY label').all() as Array<{label:string}>).map(row=>row.label),['Ambient','Neoclassical']);
});
test('a failed history refresh keeps the last valid taste clusters',async()=>{
  const before=database.prepare('SELECT * FROM listening_clusters').all();
  database.exec('UPDATE listener_music_snapshots SET captured_at=1');globalThis.fetch=async()=>{throw Error('Listening service unavailable')};
  assert.equal(await refreshListeningClusters(user.id),2);assert.deepEqual(database.prepare('SELECT * FROM listening_clusters').all(),before);
});
test.after(()=>{globalThis.fetch=original;database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
