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
import {recordPlaylistExposure,loadEvidencedCandidates,generateIntentSelection} from './selection-repository';
import {compilePlaylistIntent} from './intent-compiler';
import {configuredIntent} from './intent-schema';
import type {StructuredRequest} from '@/features/ai/client';
import {acquireChatLease,releaseChatLease,storeRefreshedChatSelection,storeChatResult,chatState} from './chat-state';
import {suggestIntentChatPlaylist} from './chat-selection';
import {unrestrictedRequirements} from './chat-agent';
import {aiClient} from '@/features/ai/client';
import {assessCandidate} from './selection-policy';
import {playlistRevisionHash} from './refresh-policy';

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
test('a model omission cannot admit a build/drop recording under the real no-climax direction',async()=>{
  const p=createPlaylist({name:'Explicit focus exclusion',category:'mood',ownerUserId:user.id,intent:'Calm instrumental music for reading. No singing or spoken word, no dramatic climaxes.',config:{targetTracks:1}});
  const client={async structured<T>(){const value=configuredIntent(p,'ignored');value.hard.vocal='instrumental';value.hard.requirements=[{field:'dynamicCharacter',values:['crescendo_build'],match:'none'}];return{data:{...value,pinFileIds:[],positionLocks:[],conflicts:[]} as T,usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}};
  const compiled=await compilePlaylistIntent(p,[],{client}),snapshot=await(await import('./listening-snapshot')).listenerMusicSnapshot(user.id),track=loadEvidencedCandidates(p,snapshot)[0];
  track.evidence.fields.dynamicCharacter={value:['moderately_dynamic'],source:'model_inference',scope:'recording',confidence:'low',references:[]};
  track.evidence.fields.structuralCharacter={value:['build_drop'],source:'model_inference',scope:'recording',confidence:'low',references:[]};
  assert.equal(compiled.detail.groundedClimaxExclusion,true);
  assert.ok(assessCandidate(track,p,compiled.intent,snapshot).violations.includes('structuralCharacter: none build_drop'));
});
test('a colloquial forgotten-favourites direction cannot hide previously enjoyed unstarred songs',async()=>{
  const p=createPlaylist({name:'Observed forgotten favourites',category:'rediscovery',ownerUserId:user.id,intent:'My forgotten jazz favourites, not jazz I have never played or favourited.',config:{targetTracks:1}});
  const client={async structured<T>(){const value=configuredIntent(p,'ignored');value.hard.favouritesOnly=true;value.soft.styles=['jazz'];return{data:{...value,pinFileIds:[],positionLocks:[],conflicts:[]} as T,usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}};
  const compiled=await compilePlaylistIntent(p,[],{client}),snapshot=await(await import('./listening-snapshot')).listenerMusicSnapshot(user.id),track=loadEvidencedCandidates(p,snapshot)[0];
  track.listener={...track.listener!,playCount:8,hasPlayed:true,favourite:false,lastPlayed:new Date(Date.now()-60*86400_000).toISOString()};
  assert.equal(compiled.intent.hard.favouritesOnly,false);assert.equal(assessCandidate(track,p,compiled.intent,snapshot).eligible,true);
});
test('a piano-jazz correction admits an ensemble while enforcing piano, vocals and electronic exclusions',async()=>{
  const p=createPlaylist({name:'Piano ensemble correction',category:'chat',ownerUserId:user.id,config:{targetTracks:1}}),snapshot=await(await import('./listening-snapshot')).listenerMusicSnapshot(user.id),track=loadEvidencedCandidates(p,snapshot)[0];
  const chat={...chatState(p.id),messages:[{role:'user' as const,content:'Make every song instrumental piano jazz. No singing, spoken word or electronic music.'}]};
  const client={async structured<T>(){const value=configuredIntent(p,'ignored');value.hard.vocal='instrumental';value.hard.requirements=[{field:'genre',values:['jazz'],match:'all'},{field:'style',values:['piano_solo'],match:'all'},{field:'genre',values:['electronic'],match:'none'}];return{data:{...value,pinFileIds:[track.fileId],positionLocks:[{fileId:track.fileId,position:0}],conflicts:[]} as T,usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}};
  const compiled=await compilePlaylistIntent(p,[track],{client,chat,interactive:true});assert.equal(compiled.detail.groundedPianoPresence,true);assert.equal(compiled.detail.groundedRetention,true);assert.deepEqual(compiled.intent.pinnedRecordings,[]);assert.deepEqual(compiled.intent.positionLocks,[]);
  track.evidence.fields.genre={value:['jazz'],source:'model_inference',scope:'recording',confidence:'low',references:[]};track.evidence.fields.style={value:['bebop'],source:'model_inference',scope:'recording',confidence:'low',references:[]};track.evidence.fields.instrumentation={value:['piano','double_bass','drums'],source:'model_inference',scope:'recording',confidence:'low',references:[]};
  assert.equal(assessCandidate(track,p,compiled.intent,snapshot).eligible,true);
  track.evidence.fields.instrumentation.value=['guitar','drums'];assert.equal(assessCandidate(track,p,compiled.intent,snapshot).eligible,false);
  track.evidence.fields.instrumentation.value=['piano'];track.evidence.fields.vocalProfile.value=['spoken'];assert.equal(assessCandidate(track,p,compiled.intent,snapshot).eligible,false);
  track.evidence.fields.vocalProfile.value=['instrumental'];track.evidence.fields.genre.value=['jazz','electronic'];assert.equal(assessCandidate(track,p,compiled.intent,snapshot).eligible,false);
});
test('a shortage preview cannot replace the previous mix',async()=>{
  database.prepare("UPDATE smart_playlists SET config_json=json_set(config_json,'$.targetTracks',10) WHERE id=?").run(foreign.id);
  const preview=await generatePlaylist(foreign.id,true);assert.equal(preview.items.length,3);
  await assert.rejects(savePlaylistPreview(foreign.id,preview.runId),/Kept the previous mix.*insufficient matching tracks/);
});
test('publication enforces the proposal intent even if a later cache entry is weaker',async()=>{
  const p=createPlaylist({name:'Immutable proposal',category:'mood',ownerUserId:user.id,config:{targetTracks:2,genres:['jazz'],moods:['warm']}}),preview=await generatePlaylist(p.id,true);
  const row=database.prepare('SELECT detail_json FROM playlist_runs WHERE id=?').get(preview.runId) as {detail_json:string},detail=JSON.parse(row.detail_json);
  assert.ok(detail.resolvedIntent);detail.resolvedIntent.hard.vocal='instrumental';
  database.prepare('UPDATE playlist_runs SET detail_json=? WHERE id=?').run(JSON.stringify(detail),preview.runId);
  const cached=database.prepare('SELECT intent_json FROM playlist_intents WHERE playlist_id=?').get(p.id) as {intent_json:string},weaker=JSON.parse(cached.intent_json);weaker.hard.vocal='any';
  database.prepare('UPDATE playlist_intents SET intent_json=? WHERE playlist_id=?').run(JSON.stringify(weaker),p.id);
  const selected=preview.items[0],original=database.prepare('SELECT profile_json FROM track_profiles WHERE file_id=?').get(selected.fileId) as {profile_json:string},changed=JSON.parse(original.profile_json);changed.vocalProfile=['clean_sung'];
  database.prepare('UPDATE track_profiles SET profile_json=? WHERE file_id=?').run(JSON.stringify(changed),selected.fileId);
  try{await assert.rejects(savePlaylistPreview(p.id,preview.runId),/evidence or availability changed/)}finally{database.prepare('UPDATE track_profiles SET profile_json=? WHERE file_id=?').run(original.profile_json,selected.fileId)}
});
test('nightly chat results retain real conversation and saved strict corrections',async()=>{
  const chat=createPlaylist({name:'Night chat',category:'chat',enabled:true,ownerUserId:user.id,config:{targetTracks:2}}),lease=acquireChatLease(chat.id);
  const messages=[{role:'user',content:'Only instrumental piano now'},{role:'assistant',content:'Saved your correction'}];
  const result={name:chat.name,reply:'Saved your correction',guidance:'Instrumental piano only',items:[],detail:{requirements:{...unrestrictedRequirements,instruments:['piano'],vocal:'instrumental'},tools:[],usage:{input_tokens:1,output_tokens:1,total_tokens:2},durationMs:1}};
  database.prepare('UPDATE playlist_chat_state SET revision=1,conversation_json=?,result_json=? WHERE playlist_id=?').run(JSON.stringify(messages),JSON.stringify(result),chat.id);
  const client={async structured<T>(){const base=configuredIntent(chat,'ignored');return{data:{summary:'Piano',hard:base.hard,soft:base.soft,positionLocks:[],pinFileIds:[],conflicts:[]} as T,usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}};
  const compiled=await compilePlaylistIntent(chat,[],{client});assert.equal(compiled.intent.hard.vocal,'instrumental');assert.ok(compiled.intent.hard.requirements.some(rule=>rule.field==='instrumentation'&&rule.values.includes('piano')));
  storeRefreshedChatSelection(chat.id,lease,[],compiled.intent);releaseChatLease(chat.id,lease);
  assert.deepEqual(chatState(chat.id).messages,messages);assert.equal(chatState(chat.id).result?.guidance,result.guidance);assert.equal(chatState(chat.id).revision,2);
  assert.equal(chatState(chat.id).result?.detail.intent?.hard.vocal,'instrumental');
});
test('managed chat uses bounded retrieval and lets real corrections supersede earlier intent while nightly refresh cannot weaken it',async()=>{
  const chat=createPlaylist({name:'Bounded conversation',category:'chat',enabled:false,ownerUserId:user.id,config:{targetTracks:1}});
  const snapshot=await(await import('./listening-snapshot')).listenerMusicSnapshot(user.id);
  let requestedArtist='Artist 1',compileCalls=0;
  const client={async structured<T>(request:StructuredRequest){
    assert.equal(request.web??false,false);
    if(request.schemaName==='playlist_intent'){
      compileCalls++;const input=JSON.parse(request.input);assert.ok(input.conversation.length);
      const intent=configuredIntent(chat,'ignored');intent.hard.artists=requestedArtist?[requestedArtist]:[];intent.hard.vocal='instrumental';
      return{data:{...intent,summary:'Saved exact artist',pinFileIds:[],positionLocks:[],conflicts:[],mandatoryPreferences:[],replaceUnpinned:false} as T,usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
    }
    assert.equal(request.priority,'interactive');const input=JSON.parse(request.input);assert.ok(input.candidates.length<=60);
    return{data:{summary:'Matching artist',tracks:input.candidates.slice(0,1).map((track:{fileId:number})=>({fileId:track.fileId,focus:'genre'}))} as T,usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  }};
  const provider={embed:async()=>[Array.from({length:1024},(_,i)=>i===0?1:0)],rerank:async(_query:string,texts:string[])=>texts.map((_,index)=>({index,score:-index}))};
  const first=await suggestIntentChatPlaylist(chat,chatState(chat.id),'Only Artist 1, no singing',1,{client,snapshot,provider});
  assert.equal(first.result.items[0].artist,'Artist 1');assert.equal(chatState(chat.id).revision,0,'Generation cannot commit a conversation');
  const save=(message:string,result:typeof first.result)=>{const state=chatState(chat.id),lease=acquireChatLease(chat.id);try{storeChatResult(chat.id,lease,[...state.messages,{role:'user',content:message},{role:'assistant',content:result.reply}],result)}finally{releaseChatLease(chat.id,lease)}};
  save('Only Artist 1, no singing',first.result);requestedArtist='Artist 2';
  const correction=await suggestIntentChatPlaylist(chat,chatState(chat.id),'Only Artist 2 instead',1,{client,snapshot,provider});
  assert.equal(correction.result.items[0].artist,'Artist 2');save('Only Artist 2 instead',correction.result);
  requestedArtist='';
  const nightly=await generateIntentSelection(chat,{client,snapshot,provider});
  assert.deepEqual(nightly.intent.hard.artists,['Artist 2']);assert.equal(nightly.intent.hard.vocal,'instrumental');assert.equal(nightly.items[0].artist,'Artist 2');
  assert.equal(compileCalls,2);assert.equal(chatState(chat.id).messages.length,4);assert.equal(chatState(chat.id).messages[2].content,'Only Artist 2 instead');
  const lease=acquireChatLease(chat.id);
  try{storeRefreshedChatSelection(chat.id,lease,nightly.items,nightly.intent,nightly.detail)}finally{releaseChatLease(chat.id,lease)}
  await generateIntentSelection(chat,{client,snapshot,provider});
  assert.equal(compileCalls,2,'A nightly selection revision cannot invalidate unchanged conversation intent');
  assert.ok(chatState(chat.id).result?.detail.selection,'The full nightly selection receipt is retained');
});
test('nightly chat reuses saved intent and never rebinds old relative locks after a configuration change',async()=>{
  let p=createPlaylist({name:'Conditional original locks',category:'chat',ownerUserId:user.id,config:{targetTracks:2}});
  const snapshot=await(await import('./listening-snapshot')).listenerMusicSnapshot(user.id),current=loadEvidencedCandidates(p,snapshot).slice(0,2);
  const saved=configuredIntent(p,playlistRevisionHash(p));saved.summary='Saved instrumental direction';saved.hard.vocal='instrumental';saved.pinnedRecordings=[{fileId:current[0].fileId,recordingKey:current[0].evidence.recordingKey}];saved.positionLocks=[{fileId:current[0].fileId,position:0}];
  const context={revision:1,messages:[{role:'user' as const,content:'Keep the first two if instrumental.'}],result:{name:p.name,reply:'Saved',guidance:saved.summary,items:[],detail:{tracks:2,pending:0,durationMs:1,usage:{input_tokens:1,output_tokens:1,total_tokens:2},tools:[],intent:saved}}};
  let calls=0;
  const client={async structured<T>(){calls++;const value=configuredIntent(p,'ignored');return{data:{...value,pinFileIds:current.map(track=>track.fileId),positionLocks:current.map((track,position)=>({fileId:track.fileId,position})),conflicts:[]} as T,usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}};
  const first=await compilePlaylistIntent(p,current,{client,chat:context});assert.equal(calls,0);assert.equal(first.detail.reusedSavedIntent,true);assert.equal(first.intent.summary,saved.summary);assert.deepEqual(first.intent.positionLocks,saved.positionLocks);
  database.prepare("UPDATE smart_playlists SET config_json=json_set(config_json,'$.targetTracks',3),revision=revision+1 WHERE id=?").run(p.id);p=getPlaylist(p.id)!;
  const changed=await compilePlaylistIntent(p,current,{client,chat:context});assert.equal(calls,1);assert.deepEqual(changed.intent.positionLocks,saved.positionLocks);assert.deepEqual(changed.intent.pinnedRecordings,saved.pinnedRecordings);assert.equal(changed.intent.hard.vocal,'instrumental');
});
test('named-song interpretation requires a real user quote and may resolve an identity after compilation',async()=>{
  const chat=createPlaylist({name:'Named-song proof',category:'chat',ownerUserId:user.id,config:{targetTracks:2}});
  let quote='Keep Song 1 first',message='Make a jazz mix';
  const client={async structured<T>(){const intent=configuredIntent(chat,'ignored');return{data:{...intent,summary:'Jazz',trackRequests:[{title:'Song 1',artist:'Artist 1',action:'include',position:0,required:false,quote}],pinFileIds:[],conflicts:[]} as T,usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}};
  const context=()=>({revision:1,messages:[{role:'user' as const,content:message}],result:null});
  await assert.rejects(compilePlaylistIntent(chat,[],{client,chat:context(),interactive:true}),/not supported by a real user direction/);
  message='Keep Song 1 first if available';quote=message;
  const compiled=await compilePlaylistIntent(chat,[],{client,chat:context(),interactive:true});
  assert.equal(compiled.intent.trackRequests[0].title,'Song 1');assert.deepEqual(compiled.intent.pinnedRecordings,[],'The model supplies names; the application resolves native library IDs');
});
test('collaborative native identities use full credits and exact paths rather than stale cached editions',()=>{
  const tags={title:['Duet'],artist:['Charlie Byrd feat. Stan Getz'],album:['Jazz Samba'],trackNumber:1,discNumber:1};
  database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES(9,'/music/Jazz/01.flac','collab','Charlie Byrd/Stan Getz','Jazz Samba','flac',9,1,1,1,?,'{}','{}','written')").run(JSON.stringify(tags));
  database.prepare("INSERT INTO track_profiles(file_id,album_key,status,profile_json,source_fingerprint,audio_fingerprint,schema_version,classifier_version,source_updated_at) VALUES(9,'collab','complete','{\"genre\":[\"jazz\"]}','fixture','fixture',1,1,CURRENT_TIMESTAMP)").run();
  const native={id:'correct',title:'Duet',artist:'Charlie Byrd',artists:['Stan Getz','Charlie Byrd'],album:'Jazz Samba',path:'/media/music/Jazz/01.flac',trackNumber:1,discNumber:1,playCount:0,hasPlayed:false,lastPlayed:null,favourite:false,rating:null,providerIds:{}};
  const snapshot={songs:[native,{...native,id:'other-edition',path:'/media/music/Jazz-other-edition/01.flac'}],complete:true,stale:false,capturedAt:'',error:'',available:true};
  assert.deepEqual(loadEvidencedCandidates(playlist,snapshot).map(song=>song.songId),['correct']);
  database.prepare("UPDATE navidrome_track_map SET jellyfin_song_id='other-edition' WHERE file_id=9").run();
  assert.equal(loadEvidencedCandidates(playlist,snapshot)[0].songId,'correct');
  assert.equal(loadEvidencedCandidates(playlist,{...snapshot,songs:[{...native,path:'/music/Wrong/01.flac'}]}).length,0);
  assert.equal(loadEvidencedCandidates(playlist,{...snapshot,songs:[{...native,artists:['Charlie Byrd']}]}).length,0);
});
test.after(()=>{globalThis.fetch=original;aiClient.structured=originalStructured;database.close();delete(globalThis as {curatorDb?:unknown}).curatorDb;rmSync(directory,{recursive:true,force:true})});
