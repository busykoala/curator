import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from '@/config';
import {db,stateSet} from '@/features/db/client';
import {provisionUser} from '@/features/auth/navidrome';
import {aiClient,type StructuredRequest} from '@/features/ai/client';
import {createPlaylist,getPlaylist,setNavidromeId,updatePlaylist} from './repository';
import {generatePlaylist,savePlaylistPreview} from './generate';
import {chatState,type ChatResult} from './chat-state';
import {configuredIntent} from './intent-schema';
import {playlistRevisionHash} from './refresh-policy';
import {unrestrictedRequirements} from './chat-agent';
const directory=mkdtempSync(join(tmpdir(),'curator-chat-publication-'));config.DATABASE_PATH=join(directory,'test.sqlite');
const database=db(),user=provisionUser({token:'receipt-test-token',navidromeUserId:'owner',username:'owner',displayName:'Owner'});
const p=createPlaylist({name:'Saved conversation',category:'chat',ownerUserId:user.id,config:{targetTracks:1,genres:['jazz']}});setNavidromeId(p.id,'native-mix');
const profile={genre:['jazz'],instrumentation:['piano'],vocalProfile:['instrumental'],mood:['warm']};
for(const id of [1,2]){
  database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES(?,?,? ,? ,?,'flac',?,1,1,1,?,'{}','{}','written')").run(id,'/music/'+id+'.flac','album-'+id,'Artist '+id,'Album '+id,id,JSON.stringify({title:['Song '+id],trackNumber:1,discNumber:1}));
  database.prepare("INSERT INTO track_profiles(file_id,album_key,status,profile_json,provenance_json,source_fingerprint,audio_fingerprint,schema_version,classifier_version,source_updated_at) VALUES(?,?,'complete',?,'{\"model\":\"fixture\"}','fixture','fixture',1,1,CURRENT_TIMESTAMP)").run(id,'album-'+id,JSON.stringify(profile));
}
const originalFetch=globalThis.fetch,originalStructured=aiClient.structured;
let published=['native-2'],writes=0,compiles=0,failAuthentication=false;
const messages=[{role:'user',content:'Instrumental piano jazz'},{role:'assistant',content:'Your saved selection'}];
function saveDraft(legacy=false){
  const intent=configuredIntent(getPlaylist(p.id)!,playlistRevisionHash(getPlaylist(p.id)!));intent.hard.vocal='instrumental';
  const result:ChatResult={name:p.name,reply:'Your saved selection',guidance:'Instrumental piano jazz',items:[{fileId:1,title:'Song 1',artist:'Artist 1',album:'Album 1',year:0,profile,score:1,reason:'Piano jazz',origin:'catalog',retained:true}],
    detail:{tracks:1,pending:0,durationMs:1,usage:{input_tokens:1,output_tokens:1,total_tokens:2},tools:[],...(legacy?{requirements:{...unrestrictedRequirements,genres:['jazz'],instruments:['piano'],vocal:'instrumental' as const}}:{intent,selection:{selectionVersion:1,evaluation:{eligible:2,changed:0,retained:1},ai:[{tools:[{name:'validate_selection',durationMs:1}]}]}})}};
  database.prepare('INSERT INTO playlist_chat_state(playlist_id,revision,conversation_json,result_json) VALUES(?,1,?,?)').run(p.id,JSON.stringify(messages),JSON.stringify(result));
}
test.beforeEach(()=>{
  database.exec('DELETE FROM playlist_runs;DELETE FROM playlist_publications;DELETE FROM playlist_chat_state;DELETE FROM playlist_intents;DELETE FROM listener_music_snapshots');
  updatePlaylist(p.id,{config:{genres:['jazz'],targetTracks:1}});stateSet('playlist_refresh_mode','enabled');published=['native-2'];writes=0;compiles=0;failAuthentication=false;
  const prior=database.prepare("INSERT INTO playlist_runs(playlist_id,owner_user_id,status,preview,config_hash,finished_at) VALUES(?,?,'complete',0,'old',CURRENT_TIMESTAMP) RETURNING id").get(p.id,user.id) as {id:number};
  database.prepare("INSERT INTO playlist_items(run_id,playlist_id,file_id,navidrome_song_id,position,score,origin,reason) VALUES(?,?,2,'native-2',0,1,'catalog','Prior mix')").run(prior.id,p.id);
  aiClient.structured=async<T>(request:StructuredRequest)=>{compiles++;assert.equal(request.schemaName,'playlist_intent');assert.equal(request.priority,'interactive');const intent=configuredIntent(getPlaylist(p.id)!,'ignored');return{data:{...intent,pinFileIds:[],positionLocks:[],conflicts:[]} as T,usage:{input_tokens:1,output_tokens:1,total_tokens:2}}};
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input)),method=init?.method??'GET';
    if(url.pathname.endsWith('/Playlists/native-mix/Items'))return Response.json({Items:published.map(Id=>({Id})),TotalRecordCount:published.length});
    if(url.pathname.endsWith('/Playlists/native-mix')&&method==='POST'){writes++;published=JSON.parse(String(init?.body)).Ids;return new Response(null,{status:204})}
    if(url.searchParams.get('IncludeItemTypes')==='Playlist')return Response.json({Items:[{Id:'native-mix',Name:p.name}],TotalRecordCount:1});
    if(url.searchParams.get('IncludeItemTypes')==='Audio')return failAuthentication?new Response('Unauthorized',{status:401}):Response.json({Items:[1,2].map(id=>({Id:'native-'+id,Name:'Song '+id,Artists:['Artist '+id],Album:'Album '+id,Path:'/music/'+id+'.flac',IndexNumber:1,ParentIndexNumber:1,UserData:{PlayCount:0}})),TotalRecordCount:2});
    throw Error('Unexpected native call '+method+' '+url.pathname);
  };
});
test('direct chat publication keeps its full selection receipt and measures changes against the published mix',async()=>{
  saveDraft();const result=await generatePlaylist(p.id,false),detail=result.detail as Record<string,unknown>;
  assert.equal(compiles,0);assert.deepEqual(published,['native-1']);assert.equal(writes,1);assert.equal(detail.selectionVersion,1);
  assert.deepEqual(detail.ai,[{tools:[{name:'validate_selection',durationMs:1}]}]);
  assert.equal((detail.evaluation as {changed:number}).changed,1);assert.equal((detail.generationEvaluation as {changed:number}).changed,0);
  assert.equal(getPlaylist(p.id)!.listeningHistoryStatus,'current');assert.deepEqual(chatState(p.id).messages,messages);
});
test('a later hard configuration cannot be bypassed by a previously valid chat result',async()=>{
  saveDraft();updatePlaylist(p.id,{config:{genres:['rock']}});
  await assert.rejects(generatePlaylist(p.id,false),/evidence or availability changed/);assert.equal(writes,0);assert.deepEqual(published,['native-2']);
});
test('legacy chat publication upgrades the real saved conversation without inventing a turn',async()=>{
  saveDraft(true);const result=await generatePlaylist(p.id,false);
  assert.equal(compiles,1);assert.equal((result.detail as Record<string,unknown>).selectionVersion,1);assert.deepEqual(published,['native-1']);
  assert.deepEqual(chatState(p.id).messages,messages);assert.equal(chatState(p.id).result?.detail.intent?.hard.vocal,'instrumental');assert.ok(chatState(p.id).result?.detail.selection);
});
test('short chat previews report the shortage and cannot replace the published mix',async()=>{
  saveDraft();updatePlaylist(p.id,{config:{targetTracks:2}});const preview=await generatePlaylist(p.id,true);
  assert.equal((preview.detail as {evaluation:{shortage:number}}).evaluation.shortage,1);
  await assert.rejects(savePlaylistPreview(p.id,preview.runId),/insufficient matching tracks/);assert.equal(writes,0);assert.deepEqual(published,['native-2']);
});
test('chat publication preserves an authentication failure instead of disguising it as missing metadata',async()=>{
  saveDraft();failAuthentication=true;await assert.rejects(generatePlaylist(p.id,false),/must sign in to Navidrome again/);assert.equal(writes,0);
});
test.after(()=>{globalThis.fetch=originalFetch;aiClient.structured=originalStructured;database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
