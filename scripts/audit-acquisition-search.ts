import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
async function main(){
const dir=mkdtempSync(join(tmpdir(),'curator-search-audit-'));process.env.DATABASE_PATH=join(dir,'audit.sqlite');
const {db}=await import('../src/features/db/client');
const {upsertTarget,targetByAlbum}=await import('../src/features/acquisition/repository');
const {findRelease}=await import('../src/features/acquisition/search');
const {clearDiscoveryCache}=await import('../src/features/acquisition/discovery');
const reset=()=>{clearDiscoveryCache();db().exec('DELETE FROM acquisition_submissions')};
const original=globalThis.fetch;
try {
upsertTarget({albumId:1,origin:'migration',artist:'Test',title:'Album'});
let mode='empty',posts:string[]=[],artistSearches=0;
globalThis.fetch=async(input,init)=>{
 const url=String(input);
 if(url.includes('/api/v2/auth/login'))return new Response('Ok.',{headers:{'set-cookie':'SID=test-cookie'}});
 if(url.includes('/api/v2/sync/maindata'))return Response.json({torrents:{},server_state:{free_space_on_disk:mode==='capacity'?1:1024**4}});
 if(url.includes('/parse?')&&mode.startsWith('generic'))return Response.json({artist:{id:1},albums:[{id:mode==='generic'?4:99}]});
 if(url.endsWith('/album/4'))return Response.json({id:4,artistId:1,title:'Greatest Hits',releaseDate:'1981-01-01',monitored:true,statistics:{percentOfTracks:0}});
 if(url.includes('/parse?')){const title=new URL(url).searchParams.get('title')??'';return Response.json({artist:{id:mode==='shared'?7:1},albums:[{id:mode==='wrong-album'?99:mode==='shared'?(title.includes('Second')?2:3):1}]})}
 if(url.includes('/blocklist?'))return Response.json({totalRecords:0,records:[]});
 if(/\/album\/[23]$/.test(url)){const id=Number(url.split('/').at(-1));return Response.json({id,artistId:7,title:id===2?'Second':'Third',monitored:true,statistics:{percentOfTracks:0}})}
 if(url.endsWith('/album/1'))return Response.json({id:1,artistId:1,title:'Album',monitored:true,statistics:{percentOfTracks:0}});
 if(url.includes('/album?artistId='))return Response.json([]);
 if(url.endsWith('/indexer'))return Response.json(url.includes('9696')?(mode==='native-outage'?[{id:3,name:'LimeTorrents',enable:true}]:['native-quota','all-deferred'].includes(mode)?[{id:10,name:'TorrentsCSV',enable:true,capabilities:{categories:[{id:8000}]}}]:[]):[{id:1,enableInteractiveSearch:true}]);
 if(url.includes('/search?')){if(mode==='native-quota')assert.equal(new URL(url).searchParams.has('categories'),false);return Response.json([{guid:'alternate',title:'Test - Album FLAC',indexerId:3,protocol:'torrent',seeders:10,size:300000000,magnetUrl:'magnet:?xt=urn:btih:0123456789012345678901234567890123456789'}]);}
 assert.match(url,/\/api\/v1\/release/);
 if(init?.method==='POST'){
  const release=JSON.parse(String(init.body));posts.push(release.indexer);
  assert.match(url,/release\/push/);
  if(mode.startsWith('repair')){assert.match(url,/release\/push/);assert.equal(release.albumId,1);if(mode==='repair-quality')assert.match(release.title,/FLAC 24bit/);const approved=mode==='repair'||mode==='repair-quality';return Response.json({approved,rejected:!approved,rejections:approved?[]:['Too large']})}
  if(mode==='timeout')throw new DOMException('Timed out','TimeoutError');
  if(release.indexer==='Bad')return new Response(mode==='download-failure'?'Downloading torrent failed via Prowlarr /download':'Unavailable',{status:mode==='download-failure'?500:409});
  return Response.json({approved:true,rejected:false});
 }
 if(mode==='native-outage')throw Error('Native search unavailable');
 if(url.includes('/release?artistId=7')){artistSearches++;return Response.json(['Second','Third'].map((title,i)=>({guid:'shared-'+i,title:'Test - '+title+' FLAC',indexer:'Good',quality:{quality:{name:'FLAC'}},protocol:'torrent',seeders:5,size:300000000,rejected:false,rejections:[]})))}
 const items=mode.startsWith('generic')?[{guid:'generic',title:'Test - Greatest Hits (1981) FLAC',indexer:'Good',quality:{quality:{name:'FLAC'}},protocol:'torrent',seeders:10,size:300000000,rejected:false,rejections:[]}]:mode.startsWith('repair')?[{guid:'repair',title:mode==='repair-quality'?'Test - Album (24bit-96kHz) FLAC':'Test  Album FLAC',indexer:'Good',quality:{quality:{name:'FLAC'}},protocol:'torrent',seeders:10,size:300000000,rejected:true,rejections:mode==='repair-quality'?['400 MB is larger than maximum allowed 300 MB']:['Unable to parse release']}]:mode==='empty'?[]:['Bad','Bad','Good'].map((source,i)=>({guid:String(i),title:'Test - Album FLAC',indexer:source,quality:{quality:{name:'FLAC'}},protocol:'torrent',seeders:10-i,size:300000000,rejected:false,rejections:[]}));
 return Response.json(items);
};
assert.equal((await findRelease(targetByAlbum(1)!,false)).grabbed,false);assert.deepEqual(posts,[]);
reset();mode='alternatives';assert.equal((await findRelease(targetByAlbum(1)!,false)).grabbed,true);assert.deepEqual(posts,['Bad','Good']);
posts=[];reset();mode='download-failure';assert.equal((await findRelease({...targetByAlbum(1)!,last_release_guid:null},false)).grabbed,true);assert.deepEqual(posts,['Bad','Good']);
posts=[];reset();mode='timeout';await assert.rejects(findRelease({...targetByAlbum(1)!,last_release_guid:null},false),/Timed out/);assert.deepEqual(posts,['Bad']);
assert.equal((await findRelease(targetByAlbum(1)!,false)).grabbed,false);assert.deepEqual(posts,['Bad']);
reset();posts=[];mode='repair';assert.equal((await findRelease({...targetByAlbum(1)!,last_release_guid:null},false)).grabbed,true);assert.deepEqual(posts,['Good']);
reset();posts=[];mode='repair-quality';assert.equal((await findRelease({...targetByAlbum(1)!,last_release_guid:null},false)).grabbed,true);assert.deepEqual(posts,['Good']);
reset();posts=[];mode='repair-rejected';assert.equal((await findRelease({...targetByAlbum(1)!,last_release_guid:null},false)).grabbed,false);assert.equal(db().prepare('SELECT * FROM acquisition_submissions').all().length,0);
reset();posts=[];mode='capacity';assert.equal((await findRelease({...targetByAlbum(1)!,last_release_guid:null},false)).grabbed,false);assert.deepEqual(posts,[]);
reset();posts=[];mode='wrong-album';assert.equal((await findRelease({...targetByAlbum(1)!,last_release_guid:null},false)).grabbed,false);assert.deepEqual(posts,[]);
reset();posts=[];mode='native-outage';assert.equal((await findRelease({...targetByAlbum(1)!,last_release_guid:null},false)).grabbed,true);assert.deepEqual(posts,['LimeTorrents (Prowlarr)']);
reset();posts=[];mode='shared';
upsertTarget({albumId:2,artistId:7,origin:'migration',artist:'Test',title:'Second'});
upsertTarget({albumId:3,artistId:7,origin:'migration',artist:'Test',title:'Third'});
assert.equal((await findRelease(targetByAlbum(2)!,false)).grabbed,true);
assert.equal((await findRelease(targetByAlbum(3)!,false,true)).grabbed,true);
assert.equal(artistSearches,1);
reset();posts=[];mode='native-quota';
db().exec('DELETE FROM acquisition_requests');
const exhausted=db().prepare("INSERT INTO acquisition_requests(kind,indexer_id) VALUES('test',-1)");
db().transaction(()=>{for(let i=0;i<300;i++)exhausted.run()})();
assert.equal((await findRelease(targetByAlbum(1)!,false)).grabbed,true);
assert.deepEqual(posts,['TorrentsCSV (Prowlarr)']);
reset();posts=[];mode='all-deferred';
db().prepare("DELETE FROM state WHERE key LIKE 'acquisition_source_%'").run();
const exhaustedDirect=db().prepare("INSERT INTO acquisition_requests(kind,indexer_id) VALUES('test',10)");
db().transaction(()=>{for(let i=0;i<300;i++)exhaustedDirect.run()})();
const previousSearch=targetByAlbum(1)!.last_search_at;
assert.equal((await findRelease(targetByAlbum(1)!,false)).searchCompleted,false);
assert.equal(targetByAlbum(1)!.last_search_at,previousSearch);
assert.deepEqual(posts,[]);
reset();posts=[];mode='generic';db().exec('DELETE FROM acquisition_requests');
upsertTarget({albumId:4,artistId:1,origin:'migration',artist:'Test',title:'Greatest Hits'});
assert.equal((await findRelease(targetByAlbum(4)!,false)).grabbed,true);
assert.deepEqual(posts,['Good']);
reset();posts=[];mode='generic-wrong';
assert.equal((await findRelease(targetByAlbum(4)!,false)).grabbed,false);
assert.deepEqual(posts,[]);
console.log('Search integration audit passed: no duplicate searches, failing sources are skipped after confirmed conflicts/download errors, and ambiguous timeouts are not retried.');
}finally{globalThis.fetch=original;db().close();rmSync(dir,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1});
