import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db,stateGet,stateSet} from '@/features/db/client';
import {listenBrainzCandidates,listenBrainzTagCandidates} from './discovery-providers';
import {defaultConfig,type PlaylistDefinition} from './types';

const directory=mkdtempSync(join(tmpdir(),'curator-discovery-cached-results-'));config.DATABASE_PATH=join(directory,'test.sqlite');const database=db();
const id=(n:number)=>`${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const seed=id(1),artist=id(2),cold=id(3),warm=id(4),group=id(5),edition=id(6);
const playlist={id:1,ownerUserId:1,config:{...defaultConfig('discovery'),genres:['electronic']}} as PlaylistDefinition;
const groupValue={id:group,title:'An actual cached album','primary-type':'Album','secondary-types':[],'first-release-date':'1999-01-01','artist-credit':[{artist:{id:artist,name:'Related artist'}}],genres:[{name:'electronic'}],relations:[]};
const cache=(provider:string,url:string,value:unknown)=>database.prepare('INSERT INTO playlist_source_cache(cache_key,provider,kind,payload_json,fetched_at,expires_at) VALUES(?,?,?,?,?,?)')
  .run(createHash('sha256').update(provider+':'+new URL(url).toString()).digest('hex'),provider,provider==='listenbrainz'?'api':'identity',JSON.stringify(value),Date.now(),Date.now()+7*86400_000);
const groupUrl=`https://musicbrainz.org/ws/2/release-group/${group}?inc=artist-credits+genres+url-rels&fmt=json`;
database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES(1,'/music/seed','seed','Seed artist','Album','flac',1,1,1,1,?,'{}','{}','written')").run(JSON.stringify({title:['Seed song'],musicbrainzArtistId:[seed]}));
database.prepare("INSERT INTO track_profiles(file_id,album_key,status,profile_json,source_fingerprint,audio_fingerprint,schema_version,classifier_version,source_updated_at) VALUES(1,'seed','complete',?,'fixture','fixture',1,1,CURRENT_TIMESTAMP)").run(JSON.stringify({genre:['electronic'],style:['techno']}));
let originalFetch:typeof fetch,calls=0;
test.beforeEach(()=>{
  database.exec('DELETE FROM playlist_source_cache;DELETE FROM playlist_source_requests;DELETE FROM state');calls=0;originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{calls++;throw Error('This scenario must use cached identities only')};
  stateSet('playlist_source_error:musicbrainz','Upstream unavailable');stateSet('playlist_source_cooldown:musicbrainz',String(Date.now()+5*60_000));
  const query=new URLSearchParams({mode:'easy',max_similar_artists:'5',max_recordings_per_artist:'2',pop_begin:'0',pop_end:'85'});
  cache('listenbrainz',`https://api.listenbrainz.org/1/lb-radio/artist/${seed}?${query}`,{[artist]:[cold,warm].map(recording_mbid=>({recording_mbid,similar_artist_mbid:artist,similar_artist_name:'Related artist'}))});
  cache('listenbrainz','https://api.listenbrainz.org/1/lb-radio/tags?'+new URLSearchParams({operator:'OR',pop_begin:'0',pop_end:'85',count:'12',tag:'electronic'}),[cold,warm].map(recording_mbid=>({recording_mbid})));
  cache('musicbrainz',`https://musicbrainz.org/ws/2/recording/${warm}?inc=artist-credits+releases+release-groups&fmt=json`,{id:warm,title:'Cached song','artist-credit':groupValue['artist-credit'],releases:[{id:edition,status:'Official',date:'1999','release-group':groupValue}]});
  cache('musicbrainz',groupUrl,groupValue);
});
test.afterEach(()=>{globalThis.fetch=originalFetch});
test('artist radio can use a later fully verified cached release after an earlier identity is deferred',async()=>{
  const cooldown=stateGet('playlist_source_cooldown:musicbrainz');const results=await listenBrainzCandidates(playlist,false);
  assert.equal(results.length,1);assert.equal(results[0].id,group);assert.equal(results[0].artistId,artist);assert.equal(results[0].identityVerified,true);
  assert.equal(calls,0);assert.equal(stateGet('playlist_source_cooldown:musicbrainz'),cooldown);
  assert.equal((database.prepare('SELECT count(*) n FROM playlist_source_requests').get() as {n:number}).n,0);
});
test('tag radio does not let an unavailable first identity hide later cached candidates',async()=>{
  const results=await listenBrainzTagCandidates(playlist,false);
  assert.equal(results.length,1);assert.equal(results[0].id,group);assert.equal(calls,0);
  assert.ok(results[0].evidence.some(source=>source.provider==='listenbrainz-tags'&&source.claims.recordingId===warm));
});
test('an exhausted request budget still allows later fully cached canonical results without another request',async()=>{
  stateSet('playlist_source_cooldown:musicbrainz','0');
  const insert=database.prepare("INSERT INTO playlist_source_requests(provider,kind,status,created_at) VALUES('fixture','api','success',?)");
  for(let i=0;i<100;i++)insert.run(Date.now());
  const results=await listenBrainzTagCandidates(playlist,false);
  assert.equal(results.length,1);assert.equal(results[0].id,group);assert.equal(calls,0);
  assert.equal((database.prepare('SELECT count(*) n FROM playlist_source_requests').get() as {n:number}).n,100);
});
test('cached results still reject a canonical artist identity that differs from the recommendation',async()=>{
  database.prepare('UPDATE playlist_source_cache SET payload_json=? WHERE cache_key=?').run(JSON.stringify({...groupValue,'artist-credit':[{artist:{id:id(7),name:'Different artist'}}]}),createHash('sha256').update('musicbrainz:'+groupUrl).digest('hex'));
  assert.deepEqual(await listenBrainzTagCandidates(playlist,false),[]);assert.equal(calls,0);
});
test('an unavailable first radio seed does not hide a later cached seed',async()=>{
  const secondSeed=id(8);
  database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES(2,'/music/second','second','Second seed','Album','flac',2,1,1,1,?,'{}','{}','written')").run(JSON.stringify({title:['Second song'],musicbrainzArtistId:[secondSeed]}));
  database.prepare("INSERT INTO track_profiles(file_id,album_key,status,profile_json,source_fingerprint,audio_fingerprint,schema_version,classifier_version,source_updated_at) VALUES(2,'second','complete',?,'fixture','fixture',1,1,CURRENT_TIMESTAMP)").run(JSON.stringify({genre:['electronic'],style:['techno']}));
  const coldIndex=Math.floor(Date.now()/86400_000)%2,warmSeed=[seed,secondSeed][1-coldIndex];
  const query=new URLSearchParams({mode:'easy',max_similar_artists:'5',max_recordings_per_artist:'2',pop_begin:'0',pop_end:'85'});
  const initialUrl=`https://api.listenbrainz.org/1/lb-radio/artist/${seed}?${query}`;
  database.prepare('DELETE FROM playlist_source_cache WHERE cache_key=?').run(createHash('sha256').update('listenbrainz:'+initialUrl).digest('hex'));
  cache('listenbrainz',`https://api.listenbrainz.org/1/lb-radio/artist/${warmSeed}?${query}`,{[artist]:[{recording_mbid:warm,similar_artist_mbid:artist,similar_artist_name:'Related artist'}]});
  stateSet('playlist_source_cooldown:listenbrainz',String(Date.now()+60_000));
  const results=await listenBrainzCandidates(playlist,false);
  assert.equal(results.length,1);assert.equal(results[0].id,group);assert.equal(calls,0);
});
test.after(()=>{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
