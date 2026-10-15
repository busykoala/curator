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
 if(url.includes('/parse?')){const title=new URL(url).searchParams.get('title')??'';return Response.json({artist:{id:mode==='shared'?7:1},albums:[{id:mode==='wrong-album'?99:mode==='shared'?(title.includes('Second')?2:3):1}]})}
 if(url.includes('/blocklist?'))return Response.json({totalRecords:0,records:[]});
 if(/\/album\/[23]$/.test(url)){const id=Number(url.split('/').at(-1));return Response.json({id,artistId:7,title:id===2?'Second':'Third',monitored:true,statistics:{percentOfTracks:0}})}
 if(url.endsWith('/album/1'))return Response.json({id:1,artistId:1,title:'Album',monitored:true,statistics:{percentOfTracks:0}});
 if(url.endsWith('/indexer'))return Response.json(url.includes('9696')?[]:[{id:1,enableInteractiveSearch:true}]);
 assert.match(url,/\/api\/v1\/release/);
 if(init?.method==='POST'){
  const release=JSON.parse(String(init.body));posts.push(release.indexer);
  assert.match(url,/release\/push/);
  if(mode.startsWith('repair')){assert.match(url,/release\/push/);assert.equal(release.albumId,1);return Response.json({approved:mode==='repair',rejected:mode!=='repair',rejections:mode==='repair'?[]:['Too large']})}
  if(mode==='timeout')throw new DOMException('Timed out','TimeoutError');
  if(release.indexer==='Bad')return new Response(mode==='download-failure'?'Downloading torrent failed via Prowlarr /download':'Unavailable',{status:mode==='download-failure'?500:409});
  return Response.json({approved:true,rejected:false});
 }
 if(url.includes('/release?artistId=7')){artistSearches++;return Response.json(['Second','Third'].map((title,i)=>({guid:'shared-'+i,title:'Test - '+title+' FLAC',indexer:'Good',quality:{quality:{name:'FLAC'}},protocol:'torrent',seeders:5,size:300000000,rejected:false,rejections:[]})))}
 const items=mode.startsWith('repair')?[{guid:'repair',title:'Test  Album FLAC',indexer:'Good',quality:{quality:{name:'FLAC'}},protocol:'torrent',seeders:10,size:300000000,rejected:true,rejections:['Unable to parse release']}]:mode==='empty'?[]:['Bad','Bad','Good'].map((source,i)=>({guid:String(i),title:'Test - Album FLAC',indexer:source,quality:{quality:{name:'FLAC'}},protocol:'torrent',seeders:10-i,size:300000000,rejected:false,rejections:[]}));
 return Response.json(items);
};
assert.equal((await findRelease(targetByAlbum(1)!,false)).grabbed,false);assert.deepEqual(posts,[]);
reset();mode='alternatives';assert.equal((await findRelease(targetByAlbum(1)!,false)).grabbed,true);assert.deepEqual(posts,['Bad','Good']);
posts=[];reset();mode='download-failure';assert.equal((await findRelease({...targetByAlbum(1)!,last_release_guid:null},false)).grabbed,true);assert.deepEqual(posts,['Bad','Good']);
posts=[];reset();mode='timeout';await assert.rejects(findRelease({...targetByAlbum(1)!,last_release_guid:null},false),/Timed out/);assert.deepEqual(posts,['Bad']);
assert.equal((await findRelease(targetByAlbum(1)!,false)).grabbed,false);assert.deepEqual(posts,['Bad']);
reset();posts=[];mode='repair';assert.equal((await findRelease({...targetByAlbum(1)!,last_release_guid:null},false)).grabbed,true);assert.deepEqual(posts,['Good']);
reset();posts=[];mode='repair-rejected';assert.equal((await findRelease({...targetByAlbum(1)!,last_release_guid:null},false)).grabbed,false);assert.equal(db().prepare('SELECT * FROM acquisition_submissions').all().length,0);
reset();posts=[];mode='capacity';assert.equal((await findRelease({...targetByAlbum(1)!,last_release_guid:null},false)).grabbed,false);assert.deepEqual(posts,[]);
reset();posts=[];mode='wrong-album';assert.equal((await findRelease({...targetByAlbum(1)!,last_release_guid:null},false)).grabbed,false);assert.deepEqual(posts,[]);
reset();posts=[];mode='shared';
upsertTarget({albumId:2,artistId:7,origin:'migration',artist:'Test',title:'Second'});
upsertTarget({albumId:3,artistId:7,origin:'migration',artist:'Test',title:'Third'});
assert.equal((await findRelease(targetByAlbum(2)!,false,true)).grabbed,true);
assert.equal((await findRelease(targetByAlbum(3)!,false,true)).grabbed,true);
assert.equal(artistSearches,1);
console.log('Search integration audit passed: no duplicate searches, failing sources are skipped after confirmed conflicts/download errors, and ambiguous timeouts are not retried.');
}finally{globalThis.fetch=original;db().close();rmSync(dir,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1});
