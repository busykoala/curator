import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db,stateSet} from '@/features/db/client';
import {provisionUser} from '@/features/auth/navidrome';
import {createPlaylist,getPlaylist,playlistSnapshot} from './repository';
import {generatePlaylist,savePlaylistPreview} from './generate';
import {recordPlaylistExposure,loadEvidencedCandidates} from './selection-repository';
import {compilePlaylistIntent} from './intent-compiler';
import {configuredIntent} from './intent-schema';
import type {StructuredRequest} from '@/features/ai/client';
import {acquireChatLease,releaseChatLease,storeRefreshedChatSelection,chatState} from './chat-state';
import {unrestrictedRequirements} from './chat-agent';
import {aiClient} from '@/features/ai/client';

const directory=mkdtempSync(join(tmpdir(),'curator-selection-integration-'));config.DATABASE_PATH=join(directory,'db.sqlite');
const database=db(),user=provisionUser({token:'listener-one',navidromeUserId:'one',username:'one',displayName:'One'}),other=provisionUser({token:'listener-two',navidromeUserId:'two',username:'two',displayName:'Two'});
const playlist=createPlaylist({name:'Same name',category:'mood',enabled:true,ownerUserId:user.id,config:{targetTracks:2,genres:['jazz'],moods:['warm']}}),foreign=createPlaylist({name:'Same name',category:'mood',enabled:true,ownerUserId:other.id,config:{targetTracks:2,genres:['jazz'],moods:['warm']}});
for(let id=1;id<=8;id++){
  const tags={title:['Song '+id],artist:['Artist '+id],album:['Album '+id]},profile={genre:['jazz'],mood:[id===8?'aggressive':'warm'],vocalProfile:['instrumental']};
  database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES(?,?,?, ?,?,'flac',?,1,1,1,?,'{}','{}','written')").run(id,'/music/'+id,'album'+id,'Artist '+id,'Album '+id,id,JSON.stringify(tags));
  database.prepare("INSERT INTO track_profiles(file_id,album_key,status,profile_json,source_fingerprint,audio_fingerprint,schema_version,classifier_version,source_updated_at) VALUES(?,?,'complete',?,'fixture','fixture',1,1,CURRENT_TIMESTAMP)").run(id,'album'+id,JSON.stringify(profile));
}
const original=globalThis.fetch,originalStructured=aiClient.structured;
test.before(()=>{
  stateSet('playlist_refresh_mode','enabled');
  aiClient.structured=async<T>(request:StructuredRequest)=>{
    assert.equal(request.schemaName,'playlist_additions');
    const input=JSON.parse(request.input);
    await request.tools?.find(tool=>tool.name==='get_listener_context')?.execute({});
    const page=await request.tools?.find(tool=>tool.name==='search_library')?.execute({query:'',offset:0,limit:20}) as {tracks:Array<{fileId:number}>}|undefined;
    const candidates=page?.tracks??input.candidates,target=input.requestedAdditions??input.target;
    return{data:{summary:'Warm jazz',tracks:candidates.slice(0,target).map((track:{fileId:number})=>({fileId:track.fileId,focus:'genre'}))} as T,usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  };
  globalThis.fetch=async(url,options)=>{
    const query=new URL(String(url));
    if(query.pathname.endsWith('/embeddings'))return Response.json({data:[{index:0,embedding:Array.from({length:1024},(_,i)=>i===0?1:0)}]});
    if(query.pathname.endsWith('/rerank'))return Response.json(JSON.parse(String(options?.body)).texts.map((_:string,index:number)=>({index,score:-index})));
    assert.equal(options?.method??'GET','GET','Selection must never publish during a preview');
    assert.equal(query.searchParams.get('IncludeItemTypes'),'Audio');
    const token=new Headers(options?.headers).get('X-Emby-Token'),ids=token==='listener-one'?[1,2,3,4]:[5,6,7,8];
    return Response.json({Items:ids.map(id=>({Id:'native-'+id,Name:'Song '+id,Artists:['Artist '+id],Album:'Album '+id,UserData:{PlayCount:0,Played:false,IsFavorite:false}})),TotalRecordCount:ids.length});
  };
});
test('same-name owner playlists use their own visible song IDs and never write exposure for previews',async()=>{
  const one=await generatePlaylist(playlist.id,true),two=await generatePlaylist(foreign.id,true);
  assert.equal(one.items.length,2);assert.equal(two.items.length,2);
  assert.ok(one.items.every(item=>item.fileId<=4));assert.ok(two.items.every(item=>item.fileId>=5&&item.fileId!==8));
  assert.equal((database.prepare('SELECT count(*) n FROM playlist_exposure').get() as {n:number}).n,0);
  assert.equal(one.detail.tracks,2);
  assert.equal(playlistSnapshot(playlist.id).stale,false);
});
test('exposure is idempotent, owner-specific and records removed recordings only after publication',()=>{
  const makeRun=(p:typeof playlist)=>database.prepare("INSERT INTO playlist_runs(playlist_id,owner_user_id,config_hash,status,preview) VALUES(?,?,'fixture','complete',0) RETURNING id").get(p.id,p.ownerUserId) as {id:number};
  const snapshot=JSON.parse((database.prepare('SELECT songs_json FROM listener_music_snapshots WHERE owner_user_id=?').get(user.id) as {songs_json:string}).songs_json);
  const pool=loadEvidencedCandidates(playlist,{songs:snapshot,complete:true,stale:false,capturedAt:'',error:'',available:true});
  const first=makeRun(playlist);recordPlaylistExposure(playlist,first.id,pool.slice(0,2),1000);recordPlaylistExposure(playlist,first.id,pool.slice(0,2),1000);
  const second=makeRun(playlist);recordPlaylistExposure(playlist,second.id,pool.slice(1,3),2000);
  assert.equal((database.prepare('SELECT count(*) n FROM playlist_exposure').get() as {n:number}).n,4);
  const removed=database.prepare('SELECT removed_at FROM playlist_exposure WHERE run_id=? AND file_id=?').get(first.id,pool[0].fileId) as {removed_at:number};assert.equal(removed.removed_at,2000);
  assert.equal((database.prepare('SELECT count(*) n FROM playlist_exposure WHERE owner_user_id=?').get(other.id) as {n:number}).n,0);
});
test('compiled description cannot remove configured exclusions, and cache is fenced by source revision',async()=>{
  database.prepare("UPDATE smart_playlists SET intent='Instrumental piano jazz only',config_json=json_set(config_json,'$.exclusions',json('[\"metal\"]')),revision=revision+1 WHERE id=?").run(playlist.id);
  const definition=getPlaylist(playlist.id)!;let requests=0;
  const client={async structured<T>(request:StructuredRequest){
    requests++;assert.ok(request.instructions?.includes('New corrections override'));
    const base=configuredIntent(definition,'model-cannot-set-this');base.hard.vocal='instrumental';base.hard.requirements=[{field:'instrumentation',values:['piano'],match:'all'}];base.hard.exclusions=[];
    return{data:{summary:'Piano jazz',hard:base.hard,soft:base.soft,positionLocks:[],pinFileIds:[],conflicts:[]} as T,usage:{input_tokens:2,output_tokens:2,total_tokens:4}};
  }};
  const result=await compilePlaylistIntent(definition,[],{client});
  assert.ok(result.intent.hard.exclusions.includes('metal'));assert.ok(result.intent.hard.requirements.some(rule=>rule.field==='genre'));assert.equal(result.intent.hard.vocal,'instrumental');
  await compilePlaylistIntent(definition,[],{client});assert.equal(requests,1);
  database.prepare('UPDATE smart_playlists SET revision=revision+1 WHERE id=?').run(playlist.id);
  await compilePlaylistIntent(getPlaylist(playlist.id)!,[],{client});assert.equal(requests,2);
});
test('a shortage preview cannot replace the previous mix',async()=>{
  database.prepare("UPDATE smart_playlists SET config_json=json_set(config_json,'$.targetTracks',10) WHERE id=?").run(foreign.id);
  const preview=await generatePlaylist(foreign.id,true);assert.equal(preview.items.length,3);
  await assert.rejects(savePlaylistPreview(foreign.id,preview.runId),/Kept the previous mix.*insufficient matching tracks/);
});
test('nightly chat results retain real conversation and saved strict corrections',async()=>{
  const chat=createPlaylist({name:'Night chat',category:'chat',enabled:true,ownerUserId:user.id,config:{targetTracks:2}}),lease=acquireChatLease(chat.id);
  const messages=[{role:'user',content:'Only instrumental piano now'},{role:'assistant',content:'Saved your correction'}];
  const result={name:chat.name,reply:'Saved your correction',guidance:'Instrumental piano only',items:[],detail:{requirements:{...unrestrictedRequirements,instruments:['piano'],vocal:'instrumental'},tools:[],usage:{input_tokens:1,output_tokens:1,total_tokens:2},durationMs:1}};
  database.prepare('UPDATE playlist_chat_state SET revision=1,conversation_json=?,result_json=? WHERE playlist_id=?').run(JSON.stringify(messages),JSON.stringify(result),chat.id);
  const client={async structured<T>(){const base=configuredIntent(chat,'ignored');return{data:{summary:'Piano',hard:base.hard,soft:base.soft,positionLocks:[],pinFileIds:[],conflicts:[]} as T,usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}};
  const compiled=await compilePlaylistIntent(chat,[],{client});assert.equal(compiled.intent.hard.vocal,'instrumental');assert.ok(compiled.intent.hard.requirements.some(rule=>rule.field==='instrumentation'&&rule.values.includes('piano')));
  storeRefreshedChatSelection(chat.id,lease,[]);releaseChatLease(chat.id,lease);
  assert.deepEqual(chatState(chat.id).messages,messages);assert.equal(chatState(chat.id).result?.guidance,result.guidance);assert.equal(chatState(chat.id).revision,2);
});
test.after(()=>{globalThis.fetch=original;aiClient.structured=originalStructured;database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
