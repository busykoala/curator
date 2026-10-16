import test from 'node:test';
import assert from 'node:assert/strict';
import {exactManualImport} from './manual-import';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
test('full release recovery imports verified untagged audio, preserves sources, and refuses native mapping conflicts',async()=>{
  const original=globalThis.fetch;
  const dir=mkdtempSync(join(tmpdir(),'curator-import-identity-'));config.DATABASE_PATH=join(dir,'test.sqlite');
  let conflict=false,unsafe=false,imports=0;
  const rows=['First Song','Second Song','Third Song'].map((title,i)=>({id:i,path:`/data/downloads/Artist - Album/${i+1}. ${title}.flac`,artist:{id:7,artistName:'Artist'},audioTags:{duration:'00:03:00',trackNumbers:[i+1]},quality:{quality:{name:'FLAC'}},tracks:[],albumReleaseId:0,rejections:[{reason:'Could not identify album'}]}));
  const tracks=rows.map((r,i)=>({id:i+100,albumId:42,artistId:7,title:r.path.split('/').at(-1)!.slice(3,-5),duration:180000,absoluteTrackNumber:i+1,mediumNumber:1}));
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith('/album/42'))return Response.json({id:42,artistId:7,monitored:true,releases:[{id:9,title:'Album',trackCount:3}]});
    if(url.pathname.endsWith('/track'))return Response.json(tracks);
    if(url.pathname.endsWith('/manualimport')){
      if(init?.method==='POST')return Response.json(rows.map((r,i)=>({...r,album:{id:42,title:'Album'},albumReleaseId:9,tracks:[{id:i+100+(conflict?1:0)}],rejections:[{reason:unsafe?'Has missing tracks':'Album match is not close enough: 60 % vs 80 %'}]})));
      return Response.json(rows);
    }
    if(url.pathname.endsWith('/command')){const command=JSON.parse(String(init?.body));assert.equal(command.importMode,'copy');assert.equal(command.replaceExistingFiles,false);assert.equal(command.files.length,3);imports++;return Response.json({id:1})}
    if(url.pathname.endsWith('/command/1'))return Response.json({id:1,status:'completed'});
    throw Error('Unexpected '+url.pathname);
  };
  const item={id:1,albumId:42,artistId:7,downloadId:'hash',status:'completed',sizeleft:0,outputPath:'/data/downloads/Artist - Album'};
  try{
    assert.ok(await exactManualImport(item));assert.equal(imports,1);
    assert.ok(db().prepare("SELECT 1 FROM state WHERE key='acquisition_identity_pending:42'").get());
    conflict=true;assert.equal(await exactManualImport(item),false);assert.equal(imports,1);
    conflict=false;unsafe=true;assert.equal(await exactManualImport(item),false);assert.equal(imports,1);
    assert.equal(await exactManualImport({...item,status:'downloading'}),false);
  }finally{globalThis.fetch=original;db().close();rmSync(dir,{recursive:true,force:true})}
});
