import test from 'node:test';
import assert from 'node:assert/strict';
import {config} from '@/config';
import {GET,POST} from '@/app/api/internal/lidarr/[...path]/route';
test('archive helper endpoint authenticates and validates the actual extracted directory before importing',async()=>{
  const originalFetch=globalThis.fetch,originalKey=config.LIDARR_API_KEY;
  config.LIDARR_API_KEY='helper-route-test-key';
  const context={params:Promise.resolve({path:['api','v1','command']})};
  const file={path:'/data/downloads/Album/01.flac',downloadId:'abc',artistId:2,albumId:3,albumReleaseId:4,trackIds:[5]};
  const command={name:'ManualImport',replaceExistingFiles:true,files:[file]};
  const rows=[{path:file.path,downloadId:'abc',artist:{id:2},album:{id:3},albumReleaseId:4,tracks:[{id:5}],rejections:[]}];
  let imports=0;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith('/queue'))return Response.json({records:[{downloadId:'abc',albumId:3,artistId:2,status:'completed',sizeleft:0,outputPath:'/data/downloads/Album.7z'}]});
    if(url.pathname.endsWith('/manualimport')){assert.equal(url.searchParams.get('artistId'),'2');assert.equal(url.searchParams.get('downloadId'),'abc');return Response.json(url.searchParams.get('folder')==='/data/downloads/Album'?rows:[])}
    if(url.pathname.endsWith('/command')){const body=JSON.parse(String(init?.body));assert.equal(body.replaceExistingFiles,false);assert.equal(body.importMode,'copy');imports++;return Response.json({id:1})}
    throw Error('Unexpected endpoint '+url.pathname);
  };
  try{
    assert.equal((await POST(new Request('http://curator/api/internal/lidarr/api/v1/command',{method:'POST',body:JSON.stringify(command)}),context)).status,403);
    const headers={'x-api-key':config.LIDARR_API_KEY,'Content-Type':'application/json'};
    const listed=await GET(new Request('http://curator/api/internal/lidarr/api/v1/manualimport?folder=%2Fdata%2Fdownloads%2FAlbum.7z',{headers}),{params:Promise.resolve({path:['api','v1','manualimport']})});
    assert.equal((await listed.json()).length,1);
    assert.equal((await POST(new Request('http://curator/api/internal/lidarr/api/v1/command',{method:'POST',headers,body:JSON.stringify(command)}),context)).status,200);
    assert.equal(imports,1);
    const wrong={...command,files:[{...file,albumId:99}]};
    assert.equal((await POST(new Request('http://curator/api/internal/lidarr/api/v1/command',{method:'POST',headers,body:JSON.stringify(wrong)}),context)).status,422);
    assert.equal(imports,1);
  }finally{globalThis.fetch=originalFetch;config.LIDARR_API_KEY=originalKey}
});
