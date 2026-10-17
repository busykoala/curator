import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {config} from '@/config';
import {db,stateGet} from '@/features/db/client';
import {clearDiscoveryCache,directCandidates,directRelease} from './discovery';
import {releasePushPayload} from './lidarr';
const dir=mkdtempSync(join(tmpdir(),'curator-discovery-'));config.DATABASE_PATH=join(dir,'test.sqlite');
after(()=>{db().close();rmSync(dir,{recursive:true,force:true})});
test('hash-only search results get an exact magnet and an explicitly observed transport date',()=>{
  const hash='0123456789012345678901234567890123456789',at='2026-10-16T19:00:00.000Z';
  const item=directRelease({title:'Quincy Jones - Big Band Bossa Nova FLAC',guid:'source-id',infoHash:hash},'TorrentsCSV',at);
  assert.equal(new URL(String(item.magnetUrl)).searchParams.get('xt'),`urn:btih:${hash}`);
  assert.equal(item.publishDate,at);assert.equal(item.publicationDateSource,'observed');
  const original={title:'Album FLAC',magnetUrl:'magnet:?xt=urn:btih:'+hash+'&tr=tracker',publishDate:'2025-01-01T00:00:00Z'};
  const preserved=directRelease(original,'Test',at);
  assert.equal(preserved.magnetUrl,original.magnetUrl);assert.equal(preserved.publishDate,original.publishDate);
  assert.equal(directRelease({title:'Album FLAC',infoHash:'invalid'},'Test',at).magnetUrl,undefined);
});
test('magnet transport also works with indexers that use downloadUrl or provide an HTTP alternative',()=>{
 const hash='0123456789012345678901234567890123456789',magnet='magnet:?xt=urn:btih:'+hash+'&dn=Album';
 for(const report of [{title:'Artist - Album FLAC',downloadUrl:magnet},{title:'Artist - Album FLAC',downloadUrl:'https://source.example/download',infoHash:hash}]){
  const release=directRelease(report,'Knaben'),payload=releasePushPayload(release);
  assert.equal(new URL(String(payload.downloadUrl)).protocol,'magnet:');
  assert.equal(new URL(String(payload.downloadUrl)).searchParams.get('xt'),'urn:btih:'+hash);
  assert.equal(payload.indexer,'Curator magnet / Knaben (Prowlarr)');
  assert.equal(payload.indexerId,0);
 }
 const http=directRelease({title:'Artist - Album FLAC',downloadUrl:'https://source.example/download'},'Knaben');
 assert.equal(http.magnetUrl,undefined);assert.equal(releasePushPayload(http).indexer,'Knaben (Prowlarr)');
});
test('Prowlarr HTTP proxies in magnetUrl are normalized by protocol using the exact info hash',()=>{
 const hash='0123456789012345678901234567890123456789',proxy='http://prowlarr.test/4/download?link=opaque&apikey=secret';
 const r=directRelease({title:'Artist - Album FLAC',magnetUrl:proxy,infoHash:hash},'Knaben'),p=releasePushPayload(r);
 assert.equal(new URL(String(p.downloadUrl)).protocol,'magnet:');
 assert.equal(new URL(String(p.downloadUrl)).searchParams.get('xt'),'urn:btih:'+hash);
 assert.equal(p.indexer,'Curator magnet / Knaben (Prowlarr)');assert.equal(p.indexerId,0);
 const http=directRelease({title:'Artist - Album FLAC',magnetUrl:proxy},'Knaben');
 assert.equal(http.magnetUrl,undefined);assert.equal(http.downloadUrl,proxy);
 assert.equal(releasePushPayload(http).indexer,'Knaben (Prowlarr)');
});
test('an unavailable preferred provider cannot suppress other sources or turn healthy zero results into errors',async()=>{
  const original=globalThis.fetch;const queried:number[]=[];
  clearDiscoveryCache();
  globalThis.fetch=async input=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith('/indexer'))return Response.json([{id:1,name:'The Pirate Bay',enable:true},{id:3,name:'LimeTorrents',enable:true},{id:12,name:'TorrentKitty',enable:true}]);
    const id=Number(url.searchParams.get('indexerIds'));queried.push(id);
    assert.equal(url.searchParams.get('query'),'Sounds of Soul Deep Volume 7');
    return id===1?Response.json({message:'Search failed due to all selected indexers being unavailable'},{status:400}):Response.json([]);
  };
  try{
    assert.deepEqual(await directCandidates('Various Artists','Sounds of Soul Deep, Volume 7'),[]);
    assert.deepEqual(queried,[3,1,12]);
    assert.match(stateGet('acquisition_source_error:1'),/temporarily unavailable/);
    clearDiscoveryCache();
    // An exhausted first provider must not stop a healthy provider either.
    db().prepare("UPDATE state SET value='0' WHERE key IN ('acquisition_source_wait:12','acquisition_source_wait:3')").run();
    const insert=db().prepare("INSERT INTO acquisition_requests(kind,indexer_id) VALUES('test',3)");
    db().transaction(()=>{for(let i=0;i<300;i++)insert.run()})();
    queried.length=0;
    assert.deepEqual(await directCandidates('Various Artists','Sounds of Soul Deep, Volume 7'),[]);
    assert.deepEqual(queried,[12]);
    assert.match(stateGet('acquisition_source_error:3'),/budget exhausted/);
  }finally{globalThis.fetch=original}
});

test('generic providers are queried without an unsupported music category and record real results',async()=>{
  db().exec('DELETE FROM state; DELETE FROM acquisition_requests; DELETE FROM source_outcomes');
  clearDiscoveryCache();
  const original=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async input=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith('/indexer'))return Response.json([{id:10,name:'TorrentsCSV',enable:true,capabilities:{categories:[{id:8000}]}}]);
    calls++;
    assert.equal(url.searchParams.has('categories'),false);
    return Response.json([{title:'Fleetwood Mac - Rumours (1977) FLAC',seeders:100,size:500000000}]);
  };
  try{
    assert.equal((await directCandidates('Fleetwood Mac','Rumours')).length,1);
    assert.equal((await directCandidates('Fleetwood Mac','Rumours')).length,1);
    assert.equal(calls,1);
    const events=db().prepare("SELECT * FROM source_outcomes WHERE event='search'").all() as Array<{detail_json:string}>;
    assert.equal(events.length,1);
    assert.equal(JSON.parse(events[0].detail_json).results,1);
    assert.equal(stateGet('acquisition_source_error:10'),'');
  }finally{globalThis.fetch=original}
});

test('music-capable providers retain the music category',async()=>{
  db().exec('DELETE FROM state; DELETE FROM acquisition_requests');clearDiscoveryCache();
  const original=globalThis.fetch;
  globalThis.fetch=async input=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith('/indexer'))return Response.json([{id:3,name:'LimeTorrents',enable:true,capabilities:{categories:[{id:3000,subCategories:[{id:3040}]}]}}]);
    assert.equal(url.searchParams.get('categories'),'3000');return Response.json([]);
  };
  try{assert.deepEqual(await directCandidates('Test','Album'),[])}finally{globalThis.fetch=original}
});

test('an enabled Knaben provider adds capacity while a manually disabled one stays unused',async()=>{
  db().exec('DELETE FROM state; DELETE FROM acquisition_requests');clearDiscoveryCache();
  const original=globalThis.fetch;let enabled=false,calls=0;
  globalThis.fetch=async input=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith('/indexer'))return Response.json([{id:4,name:'Knaben',enable:enabled,capabilities:{categories:[{id:3000}]}}]);
    calls++;assert.equal(url.searchParams.get('indexerIds'),'4');assert.equal(url.searchParams.get('categories'),'3000');return Response.json([]);
  };
  try{
    await assert.rejects(directCandidates('Test','Album'),/No enabled discovery providers/);assert.equal(calls,0);
    enabled=true;clearDiscoveryCache();assert.deepEqual(await directCandidates('Test','Album'),[]);assert.equal(calls,1);
  }finally{globalThis.fetch=original}
});

test('a second discovery batch reaches other providers after two healthy empty searches',async()=>{
 db().exec('DELETE FROM state; DELETE FROM acquisition_requests');clearDiscoveryCache();
 const original=globalThis.fetch,queried:number[]=[];
 globalThis.fetch=async input=>{
  const u=new URL(String(input));
  if(u.pathname.endsWith('/indexer'))return Response.json([{id:10,name:'TorrentsCSV',enable:true},{id:4,name:'Knaben',enable:true},{id:3,name:'LimeTorrents',enable:true}]);
  const id=Number(u.searchParams.get('indexerIds'));queried.push(id);
  return Response.json(id===3?[{title:'Test - Album FLAC',infoHash:'0123456789012345678901234567890123456789',seeders:10,size:300000000}]:[]);
 };
 try{
  assert.deepEqual(await directCandidates('Test','Album'),[]);
  assert.equal((await directCandidates('Test','Album',true)).length,1);
  assert.deepEqual(queried,[10,4,3]);
 }finally{globalThis.fetch=original}
});

test('enabled generic audio providers remain reachable independently of combined native searches',async()=>{
 db().exec('DELETE FROM state; DELETE FROM acquisition_requests');clearDiscoveryCache();
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async input=>{const u=new URL(String(input));
  if(u.pathname.endsWith('/indexer'))return Response.json([{id:8,name:'Configured audio provider',enable:true,protocol:'torrent',capabilities:{searchParams:['q'],categories:[{id:3000}]}},{id:99,name:'Disabled provider',enable:false,protocol:'torrent',capabilities:{searchParams:['q'],categories:[{id:3000}]}}]);
  calls++;assert.equal(u.searchParams.get('indexerIds'),'8');assert.equal(u.searchParams.get('categories'),'3000');return Response.json([]);
 };
 try{assert.deepEqual(await directCandidates('Test','Album'),[]);assert.equal(calls,1)}finally{globalThis.fetch=original}
});
