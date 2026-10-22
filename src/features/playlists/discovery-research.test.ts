import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db,stateSet} from '@/features/db/client';
import {createPlaylist} from './repository';
import {researchDiscoveryPools,discoveryPoolNeedsResearch} from './discovery-research';
import {discoveryRecommendations,type DiscoveryRelease} from './discovery-repository';
const directory=mkdtempSync(join(tmpdir(),'curator-discovery-research-'));config.DATABASE_PATH=join(directory,'test.sqlite');const database=db();
database.exec("INSERT INTO curator_users(id,navidrome_user_id,username,display_name) VALUES(1,'one','one','One')");
const p=createPlaylist({name:'Techno',category:'discovery',enabled:true,ownerUserId:1,config:{genres:['electronic']}});
const releases:DiscoveryRelease[]=Array.from({length:12},(_,i):DiscoveryRelease=>({id:'verified-'+i,artistId:'artist',artist:'東京',album:'Older music '+i,releaseDate:'1999-01-01',genres:['electronic'],identityVerified:true,evidence:[{provider:'musicbrainz',url:'https://musicbrainz.org/release-group/fixture',fetchedAt:new Date().toISOString(),scope:'release',claims:{releaseGroupId:'verified-'+i,album:'Older music '+i}},{provider:'editorial',url:'https://example.com/review',fetchedAt:new Date().toISOString(),scope:'release',claims:{artist:'東京',album:'Older music '+i}}]}));
test.beforeEach(()=>{database.exec('DELETE FROM playlist_discovery_recommendations;DELETE FROM playlist_discovery_releases;DELETE FROM state')});
test('research continues after a provider failure and fills a bounded pool with older releases',async()=>{
  const result=await researchDiscoveryPools([{name:'broken',load:async()=>{throw Error('Search unavailable')}},{name:'working',load:async()=>releases}]);
  assert.equal(result.researched,10);assert.equal(discoveryRecommendations(p.id,1).length,10);
  assert.equal(discoveryPoolNeedsResearch(p),false);
  assert.equal((database.prepare('SELECT count(*) n FROM playlist_discovery_admissions').get() as {n:number}).n,0,'research does not submit acquisitions');
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
test.after(()=>{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
