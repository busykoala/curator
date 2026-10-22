import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {config} from '@/config';
import {db} from '@/features/db/client';
import {createPlaylist,playlistSnapshot,playlistRuns} from './repository';
import {playlistRevisionHash} from './refresh-policy';
import {savePlaylistPreview} from './generate';
const directory=mkdtempSync(join(tmpdir(),'curator-run-visibility-'));config.DATABASE_PATH=join(directory,'test.sqlite');const database=db();
database.exec("INSERT INTO curator_users(id,navidrome_user_id,username,display_name) VALUES(1,'one','one','One')");
const p=createPlaylist({name:'Visible mix',category:'mood',ownerUserId:1,config:{targetTracks:1}});
for(let id=1;id<=3;id++)database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES(?,?,'album','Artist','Album','flac',?,1,1,1,?,'{}','{}','written')").run(id,'/music/'+id,id,JSON.stringify({title:['Song '+id]}));
function run(kind:string,preview:number,fileId:number){const row=database.prepare("INSERT INTO playlist_runs(playlist_id,owner_user_id,config_hash,status,preview,source_kind) VALUES(?,1,?,'complete',?,?) RETURNING id").get(p.id,playlistRevisionHash(p),preview,kind) as {id:number};database.prepare("INSERT INTO playlist_items(run_id,playlist_id,file_id,position,score,origin,reason) VALUES(?,?,?,0,1,'catalog','Fixture')").run(row.id,p.id,fileId);return row.id}
test('shadow comparisons cannot appear as the saved mix or be saved through the preview action',async()=>{
  const saved=run('background',0,1),shadow=run('shadow',1,2);
  const view=playlistSnapshot(p.id);assert.equal(view.runId,saved);assert.equal(view.preview,false);assert.equal((view.items[0] as unknown as {fileId:number}).fileId,1);assert.equal(playlistRuns(p.id).length,1);
  await assert.rejects(savePlaylistPreview(p.id,shadow),/background comparison/);
});
test('nightly proposals remain internal until publication; an explicit manual preview remains reviewable',()=>{
  const manual=run('manual',1,2);run('background',1,3);
  let view=playlistSnapshot(p.id);assert.equal(view.runId,manual);assert.equal(view.preview,true);assert.equal((view.items[0] as unknown as {fileId:number}).fileId,2);
  const published=run('background',0,3);view=playlistSnapshot(p.id);assert.equal(view.runId,published);assert.equal(view.preview,false);assert.equal((view.items[0] as unknown as {fileId:number}).fileId,3);
});
test.after(()=>{database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
