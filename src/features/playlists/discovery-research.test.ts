import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db,stateSet,stateGet} from '@/features/db/client';
import {createPlaylist,updatePlaylist} from './repository';
import {aiClient} from '@/features/ai/client';
import {researchDiscoveryPools,discoveryPoolNeedsResearch,runDiscoveryMaintenance} from './discovery-research';
import {discoveryRecommendations,storeDiscoveryRecommendation,verifiedDiscoveryRecommendation,type DiscoveryRelease} from './discovery-repository';
const directory=mkdtempSync(join(tmpdir(),'curator-discovery-research-'));config.DATABASE_PATH=join(directory,'test.sqlite');const database=db();
database.exec("INSERT INTO curator_users(id,navidrome_user_id,username,display_name) VALUES(1,'one','one','One')");
const p=createPlaylist({name:'Techno',category:'discovery',enabled:true,ownerUserId:1,config:{genres:['electronic']}});
const releases:DiscoveryRelease[]=Array.from({length:12},(_,i):DiscoveryRelease=>({id:'verified-'+i,artistId:'artist',artist:'東京',album:'Older music '+i,releaseDate:'1999-01-01',genres:['electronic'],identityVerified:true,evidence:[{provider:'musicbrainz',url:'https://musicbrainz.org/release-group/fixture',fetchedAt:new Date().toISOString(),scope:'release',claims:{releaseGroupId:'verified-'+i,album:'Older music '+i}},{provider:'editorial',url:'https://example.com/review',fetchedAt:new Date().toISOString(),scope:'release',claims:{artist:'東京',album:'Older music '+i}}]}));
test.beforeEach(()=>{database.exec('DELETE FROM playlist_discovery_recommendations;DELETE FROM playlist_discovery_releases;DELETE FROM playlist_source_requests;DELETE FROM state')});
test('research continues after a provider failure and fills a bounded pool with older releases',async()=>{
  let unnecessary=0;
  const result=await researchDiscoveryPools([{name:'broken',load:async()=>{throw Error('Search unavailable')}},{name:'working',load:async()=>releases},{name:'unneeded',load:async()=>{unnecessary++;return releases}}]);
  assert.equal(result.researched,10);assert.equal(discoveryRecommendations(p.id,1).length,10);
  assert.equal(discoveryPoolNeedsResearch(p),false);
  assert.equal(unnecessary,0,'a full verified pool must not consume more source requests');
  assert.equal((database.prepare('SELECT count(*) n FROM playlist_discovery_admissions').get() as {n:number}).n,0,'research does not submit acquisitions');
});
test('an acquisition dependency outage cannot suppress independent discovery research',async()=>{
  let researched=0,admitted=0;
  await runDiscoveryMaintenance({lifecycle:async()=>{throw Error('Lidarr unavailable')},admit:async()=>{admitted++;return{admitted:0,active:0}},research:async()=>{researched++;return{researched:1,queued:0}}});
  assert.equal(researched,1);assert.equal(admitted,0);assert.match(stateGet('playlist_discovery_error'),/Lidarr unavailable/);
});
test('fresh verified evidence upgrades an associated legacy acquisition without changing its ID or dropping the queue state',async()=>{
  storeDiscoveryRecommendation(p,releases[0],'Legacy association','legacy');
  database.prepare("UPDATE playlist_discovery_recommendations SET status='queued',evidence_json='[]' WHERE release_id=?").run(releases[0].id);
  database.prepare('UPDATE playlist_discovery_releases SET identity_verified_at=NULL WHERE id=?').run(releases[0].id);
  const before=discoveryRecommendations(p.id,1)[0];assert.equal(verifiedDiscoveryRecommendation(before),false);
  const result=await researchDiscoveryPools([{name:'working',load:async()=>releases}]);
  const after=discoveryRecommendations(p.id,1).find(rec=>rec.release_id===releases[0].id)!;
  assert.equal(after.id,before.id);assert.equal(after.status,'queued');assert.equal(verifiedDiscoveryRecommendation(after),true);assert.equal(result.researched,10);
});
test('a bare URL or incorrect identity claim cannot admit an automatic recommendation',async()=>{
  const malformed=releases.map(r=>({...r,evidence:r.evidence.filter(e=>e.provider==='musicbrainz')}));
  malformed.push({...releases[0],id:'wrong',evidence:releases[0].evidence});
  assert.equal((await researchDiscoveryPools([{name:'unproven',load:async()=>malformed}])).researched,0);
});
test('every fourth research cycle targets recent releases without excluding old catalogue on other cycles',async()=>{
  let recent=false;stateSet(`playlist_research_cycles:${p.id}`,'3');
  const result=await researchDiscoveryPools([{name:'test',load:async(_p,r)=>{recent=r;return releases}}]);
  assert.equal(recent,true);assert.equal(result.researched,0);
});
test('partial research after an identity outage retries promptly without clearing provider cooldowns',async()=>{
  const retryAt=Date.now()+45*60_000;
  const before=Date.now();
  await researchDiscoveryPools([{name:'radio',load:async()=>{
    stateSet('playlist_source_error:musicbrainz','MusicBrainz returned 503');
    stateSet('playlist_source_cooldown:musicbrainz',String(retryAt));
    return releases.slice(0,2);
  }}]);
  const next=Number(stateGet(`playlist_research_next:${p.id}`));
  assert.ok(next>=before+15*60_000&&next<=Date.now()+17*60_000);
  assert.equal(stateGet('playlist_source_cooldown:musicbrainz'),String(retryAt));
  const outcome=JSON.parse(stateGet(`playlist_research_outcome:${p.id}`));
  assert.equal(outcome.availability,'source_deferred');assert.equal(outcome.deferredSources[0].provider,'musicbrainz');
  assert.equal(discoveryRecommendations(p.id,1).length,2);
});
test('successful empty research remains distinct from unavailable providers and keeps its ordinary cadence',async()=>{
  stateSet('playlist_source_error:musicbrainz','Old failure');stateSet('playlist_source_cooldown:musicbrainz',String(Date.now()-1000));
  const before=Date.now();await researchDiscoveryPools([{name:'empty',load:async()=>[]}]);
  assert.ok(Number(stateGet(`playlist_research_next:${p.id}`))>=before+2*3600_000);
  const outcome=JSON.parse(stateGet(`playlist_research_outcome:${p.id}`));
  assert.equal(outcome.availability,'no_new_matches');assert.deepEqual(outcome.deferredSources,[]);
});
test('a successful response that exhausts a provider quota remains a deferral even without an error message',async()=>{
  stateSet('playlist_source_cooldown:listenbrainz',String(Date.now()+60_000));
  await researchDiscoveryPools([{name:'cached',load:async()=>[]}]);
  const outcome=JSON.parse(stateGet(`playlist_research_outcome:${p.id}`));
  assert.equal(outcome.availability,'source_deferred');assert.equal(outcome.deferredSources[0].provider,'listenbrainz');
  assert.equal(outcome.deferredSources[0].error,'Provider cooldown active');
});
test('a growing but underfilled healthy pool replenishes promptly instead of waiting two hours',async()=>{
  const before=Date.now();await researchDiscoveryPools([{name:'partial',load:async()=>releases.slice(0,2)}]);
  const next=Number(stateGet(`playlist_research_next:${p.id}`));
  assert.ok(next>=before+15*60_000&&next<=Date.now()+17*60_000);
  assert.equal(JSON.parse(stateGet(`playlist_research_outcome:${p.id}`)).availability,'available');
});
test('an outage early in a longer cycle remains visible after its cooldown expires',async()=>{
  const before=Date.now();await researchDiscoveryPools([{name:'partial',load:async()=>{
    database.prepare("INSERT INTO playlist_source_requests(provider,kind,created_at,status,detail) VALUES('musicbrainz','identity',?,'failed','503 during this cycle')").run(Date.now());
    stateSet('playlist_source_error:musicbrainz','503 during this cycle');stateSet('playlist_source_cooldown:musicbrainz',String(Date.now()-1));
    return[];
  }}]);
  const outcome=JSON.parse(stateGet(`playlist_research_outcome:${p.id}`));
  assert.equal(outcome.availability,'source_deferred');assert.deepEqual(outcome.deferredSources,[]);
  assert.equal(outcome.requestFailures[0].provider,'musicbrainz');
  assert.ok(Number(stateGet(`playlist_research_next:${p.id}`))>=before+15*60_000&&Number(stateGet(`playlist_research_next:${p.id}`))<=Date.now()+17*60_000);
});
test('an exhausted global request budget defers underfilled research to the next UTC budget day',async()=>{
  database.exec("DELETE FROM playlist_source_requests");
  const now=Date.now(),day=new Date(now).setUTCHours(0,0,0,0);
  const insert=database.prepare("INSERT INTO playlist_source_requests(provider,kind,created_at,status) VALUES('fixture','api',?,'success')");
  for(let i=0;i<100;i++)insert.run(now);
  await researchDiscoveryPools([{name:'cached',load:async()=>releases.slice(0,2)}]);
  const next=Number(stateGet(`playlist_research_next:${p.id}`));
  assert.ok(next>=day+86400_000&&next<day+86400_000+120_000);
  assert.equal(JSON.parse(stateGet(`playlist_research_outcome:${p.id}`)).availability,'budget_deferred');
  database.exec('DELETE FROM playlist_source_requests');
});
test('an invalid playlist description cannot freeze the research cursor for other playlists',async()=>{
  const original=aiClient.structured;updatePlaylist(p.id,{intent:'INVALID direction'});
  createPlaylist({name:'Other research',category:'discovery',enabled:true,ownerUserId:1,config:{genres:['electronic']}});
  stateSet('playlist_research_cursor','1'); // Names sort Other research before Techno.
  aiClient.structured=async()=>{throw Error('Invalid direction fixture')};
  try{
    const adapters=[{name:'working',load:async()=>releases}];
    await assert.rejects(researchDiscoveryPools(adapters),/Invalid direction/);
    assert.equal((await researchDiscoveryPools(adapters)).researched,10);
  }finally{aiClient.structured=original;updatePlaylist(p.id,{intent:''})}
});
test.after(()=>{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
