import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {schemaSql} from '@/features/db/schema';
import {createPlaylist,updatePlaylist} from './repository';
import {storeDiscoveryRecommendation,discoveryRecommendations,reserveDiscoveryAdmission,dismissDiscoveryRecommendation,type DiscoveryRecommendation} from './discovery-repository';
import {discoveryProgressDecision,refreshDiscoveryLifecycle,queueDiscoveryRecommendations} from './discovery-lifecycle';

const directory=mkdtempSync(join(tmpdir(),'curator-discovery-lifecycle-'));config.DATABASE_PATH=join(directory,'test.sqlite');
const old=new Database(config.DATABASE_PATH);old.exec(schemaSql);old.exec(`ALTER TABLE smart_playlists ADD COLUMN owner_user_id INTEGER;
INSERT INTO curator_users(id,navidrome_user_id,username,display_name) VALUES(1,'one','one','One'),(2,'two','two','Two');
INSERT INTO smart_playlists(name,category,owner_user_id) VALUES('Ambiguous','discovery',1),('Ambiguous','discovery',2),('Unique','discovery',1);
INSERT INTO discovery_candidates(lane,artist,album) VALUES('Ambiguous','A','A'),('Unique','B','B');`);old.close();
const database=db();
const playlists=Array.from({length:4},(_,i)=>createPlaylist({name:'Pool '+i,category:'discovery',ownerUserId:i%2+1,enabled:true,config:{}}));
let serial=0;
function recommend(p=playlists[0],id='release-'+(++serial)){
  storeDiscoveryRecommendation(p,{id,artistId:'artist',artist:'Artist',album:'Album '+id,genres:['electronic'],identityVerified:true,
    evidence:[{provider:'fixture',url:'https://example.com/recommendation',fetchedAt:new Date().toISOString(),scope:'release',claims:{releaseGroupId:id}}]},'Fits the style','fixture');
  return discoveryRecommendations(p.id,p.ownerUserId).find(r=>r.release_id===id)!;
}
test.beforeEach(()=>{database.exec('DELETE FROM playlist_discovery_admissions;DELETE FROM playlist_discovery_recommendations;DELETE FROM playlist_discovery_releases')});
test('legacy names bind only to a unique owner/playlist and survive later renames',()=>{
  const rows=database.prepare('SELECT lane,playlist_id,owner_user_id FROM discovery_candidates ORDER BY id').all() as Array<{lane:string;playlist_id:number|null;owner_user_id:number|null}>;
  assert.equal(rows[0].playlist_id,null);assert.equal(rows[0].owner_user_id,null);
  assert.equal(rows[1].playlist_id,3);assert.equal(rows[1].owner_user_id,1);
  const rec=recommend();updatePlaylist(playlists[0].id,{name:'Renamed pool'});
  assert.equal(discoveryRecommendations(playlists[0].id,1)[0].id,rec.id);
});
test('shared release evidence never shares recommendations, dismissal or feedback between owners',()=>{
  const first=recommend(playlists[0],'shared'),second=recommend(playlists[1],'shared');
  assert.notEqual(first.id,second.id);assert.equal((database.prepare('SELECT count(*) n FROM playlist_discovery_releases').get() as {n:number}).n,1);
  assert.deepEqual(discoveryRecommendations(playlists[0].id,playlists[1].ownerUserId),[]);
  assert.equal(dismissDiscoveryRecommendation(first.id,playlists[0].id,playlists[1].ownerUserId),false);
  assert.equal(dismissDiscoveryRecommendation(first.id,playlists[0].id,playlists[0].ownerUserId),true);
  assert.equal(discoveryRecommendations(playlists[1].id,playlists[1].ownerUserId)[0].status,'researched');
  assert.throws(()=>storeDiscoveryRecommendation({...playlists[0],ownerUserId:2},{id:'x',artistId:'a',artist:'A',album:'A',genres:[],evidence:[],identityVerified:false},'',''),/verified/);
});
test('daily and active acquisition caps are atomic and applied across playlists',()=>{
  const recs=playlists.map(p=>recommend(p));
  assert.ok(reserveDiscoveryAdmission(recs[0],0));assert.equal(reserveDiscoveryAdmission(recommend(playlists[0]),0),null);
  assert.ok(reserveDiscoveryAdmission(recs[1],0));assert.ok(reserveDiscoveryAdmission(recs[2],0));
  assert.equal(reserveDiscoveryAdmission(recs[3],0),null);
  database.exec('DELETE FROM playlist_discovery_admissions');
  assert.equal(reserveDiscoveryAdmission(recs[3],6),null);
});
test('48-hour recommendation deferral uses actual progress without deleting the acquisition',async()=>{
  const rec=recommend();
  database.prepare("UPDATE playlist_discovery_recommendations SET status='queued',queued_at=datetime('now','-60 hours'),last_progress_at=datetime('now','-60 hours'),last_size_left=100 WHERE id=?").run(rec.id);
  const dependencies={queue:async()=>[],torrents:async()=>[],ready:async()=>[],target:()=>undefined,add:async()=>{throw Error('Must not add while reconciling')},lookup:async()=>({albums:[]})} as unknown as NonNullable<Parameters<typeof refreshDiscoveryLifecycle>[0]>;
  const result=await refreshDiscoveryLifecycle(dependencies);assert.equal(result.deferred,1);
  const after=discoveryRecommendations(rec.playlist_id,rec.owner_user_id)[0];assert.equal(after.status,'deferred');assert.ok(after.cooldown_until);
  const withProgress=discoveryProgressDecision({...rec,queued_at:new Date(Date.now()-60*3600000).toISOString(),last_progress_at:new Date(Date.now()-60*3600000).toISOString(),last_size_left:100},90,null);
  assert.equal(withProgress.defer,false);assert.equal(withProgress.progressed,true);
  assert.equal((database.prepare('SELECT count(*) n FROM playlist_feedback').get() as {n:number}).n,0);
});
test('a recommendation is ready only after the injected playable identity proof succeeds',async()=>{
  const rec=recommend();
  const dependencies={queue:async()=>[],torrents:async()=>[],ready:async()=>[123],target:()=>undefined,add:async()=>{throw Error('Must not download playable music')},lookup:async()=>({albums:[]})} as unknown as NonNullable<Parameters<typeof refreshDiscoveryLifecycle>[0]>;
  await refreshDiscoveryLifecycle(dependencies);
  const after=discoveryRecommendations(rec.playlist_id,rec.owner_user_id)[0];assert.equal(after.status,'ready');
  assert.equal((database.prepare('SELECT count(*) n FROM playlist_feedback').get() as {n:number}).n,0,'readiness does not pin an arbitrary first file');
});
test('uncertain admissions retain their cap until a verified receipt reconciles them',async()=>{
  const rec=recommend();let adds=0;
  const dependencies={queue:async()=>[],torrents:async()=>[],ready:async()=>[],target:()=>undefined,add:async()=>{adds++;throw Error('Lost receipt')},lookup:async()=>({albums:[{id:123,foreignAlbumId:rec.release_id,artist:{foreignArtistId:'artist'}}]})} as unknown as NonNullable<Parameters<typeof queueDiscoveryRecommendations>[0]>;
  await queueDiscoveryRecommendations(dependencies);await queueDiscoveryRecommendations(dependencies);assert.equal(adds,1);
  database.exec("UPDATE playlist_discovery_admissions SET created_at=datetime('now','-20 minutes')");
  await queueDiscoveryRecommendations(dependencies);assert.equal(adds,1);
  assert.equal(discoveryRecommendations(rec.playlist_id,rec.owner_user_id)[0].status,'queued');
});
test.after(()=>{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
