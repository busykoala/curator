import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
async function main(){
const dir=mkdtempSync(join(tmpdir(),'curator-search-audit-'));process.env.DATABASE_PATH=join(dir,'audit.sqlite');
const {db}=await import('../src/features/db/client');
const {upsertTarget,targetByAlbum}=await import('../src/features/acquisition/repository');
const {findRelease}=await import('../src/features/acquisition/search');
const original=globalThis.fetch;
try {
upsertTarget({albumId:1,origin:'migration',artist:'Test',title:'Album'});
let mode='empty',posts:string[]=[];
globalThis.fetch=async(input,init)=>{
 const url=String(input); assert.match(url,/\/api\/v1\/release/);
 if(init?.method==='POST'){
  const release=JSON.parse(String(init.body));posts.push(release.indexer);
  if(mode==='timeout')throw new DOMException('Timed out','TimeoutError');
  return new Response(release.indexer==='Bad'?'Unavailable':'{}',{status:release.indexer==='Bad'?409:200});
 }
 const items=mode==='empty'?[]:['Bad','Bad','Good'].map((source,i)=>({guid:String(i),indexer:source,quality:{quality:{name:'FLAC'}},protocol:'torrent',seeders:10-i,size:300000000,rejected:false,rejections:[]}));
 return Response.json(items);
};
assert.equal((await findRelease(targetByAlbum(1)!,false)).grabbed,false);assert.deepEqual(posts,[]);
mode='alternatives';assert.equal((await findRelease(targetByAlbum(1)!,false)).grabbed,true);assert.deepEqual(posts,['Bad','Good']);
posts=[];mode='timeout';await assert.rejects(findRelease({...targetByAlbum(1)!,last_release_guid:null},false),/Timed out/);assert.deepEqual(posts,['Bad']);
console.log('Search integration audit passed: no duplicate searches, alternate sources after confirmed failures, no duplicate grabs on ambiguous timeouts.');
}finally{globalThis.fetch=original;db().close();rmSync(dir,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1});
