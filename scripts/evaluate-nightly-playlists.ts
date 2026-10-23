import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {config} from '../src/config';
import {db,stateGet,stateSet} from '../src/features/db/client';
import {CuratorAiClient,aiModel} from '../src/features/ai/client';
import {InferenceYieldError} from '../src/features/ai/scheduler';
import {createPlaylist} from '../src/features/playlists/repository';
import {generateIntentSelection,loadEvidencedCandidates} from '../src/features/playlists/selection-repository';
import {listenerMusicSnapshot,type ListenerSnapshot} from '../src/features/playlists/listening-snapshot';
import {playlistIntentCases} from '../src/features/playlists/evaluation-cases';
import {defaultConfig,type PlaylistDefinition} from '../src/features/playlists/types';
import {scenarioViolations,independentEligibleCount} from '../src/features/playlists/evaluation-oracle';
import {suggestIntentChatPlaylist} from '../src/features/playlists/chat-selection';
import {chatState,acquireChatLease,storeChatResult,releaseChatLease,type ChatResult} from '../src/features/playlists/chat-state';
import type {EvidencedCandidate} from '../src/features/playlists/selection-policy';

const values=(v:unknown)=>Array.isArray(v)?v.map(String):v==null?[]:[String(v)];
async function main(){
  const target=process.env.PLAYLIST_EVAL_DB_PATH;
  if(!target?.startsWith('/tmp/curator-renewal-eval-')||!target.endsWith('.sqlite')||config.DATABASE_PATH!==target)throw Error('Evaluation requires a separately supplied temporary database copy; refusing to migrate or modify any other path');
  const fixturePath=process.env.PLAYLIST_EVAL_FIXTURE??'/tmp/curator-renewal-eval-code/baseline.json',baseline=JSON.parse(readFileSync(fixturePath,'utf8'));
  const database=db(),owner=database.prepare("SELECT id FROM curator_users WHERE username='busykoala' AND token_ciphertext IS NOT NULL").get() as {id:number}|undefined;
  if(!owner)throw Error('The requested listener is unavailable in the evaluation copy');
  if(stateGet('playlist_eval_fixture_hash')!==baseline.fixtureHash){
    const fixed=new Set<number>(baseline.fixture.tracks.map((track:{fileId:number})=>track.fileId));
    database.transaction(()=>{
      const files=database.prepare(`SELECT f.id,f.artist_name,f.album_name,f.tags_json,p.profile_json,p.provenance_json FROM files f
        LEFT JOIN track_profiles p ON p.file_id=f.id`).all() as Array<{id:number;artist_name:string;album_name:string;tags_json:string;profile_json:string|null;provenance_json:string|null}>,byId=new Map(files.map(file=>[file.id,file]));
      const updateFile=database.prepare('UPDATE files SET artist_name=?,album_name=?,tags_json=? WHERE id=?'),updateProfile=database.prepare('UPDATE track_profiles SET profile_json=?,provenance_json=? WHERE file_id=?');
      for(const track of baseline.fixture.tracks){
        const original=byId.get(track.fileId);if(!original)continue;
        const tags=JSON.stringify({...JSON.parse(original.tags_json),...track.tags}),profile=JSON.stringify(track.profile),provenance=JSON.stringify(track.provenance);
        // File/profile writes rebuild the existing search index. Never rewrite
        // the whole frozen library when its content is already identical.
        if(original.artist_name!==track.artist||original.album_name!==track.album||JSON.stringify(JSON.parse(original.tags_json))!==tags)updateFile.run(track.artist,track.album,tags,track.fileId);
        if(original.profile_json!==profile||original.provenance_json!==provenance)updateProfile.run(profile,provenance,track.fileId);
      }
      for(const file of files)if(!fixed.has(file.id))database.prepare("UPDATE files SET status='evaluation_excluded' WHERE id=?").run(file.id);
      stateSet('playlist_eval_fixture_hash',baseline.fixtureHash);
    })();
  }
  // These are copy-only controls. No worker process runs against this file.
  stateSet('playlist_refresh_mode','enabled');stateSet('paused','false');
  database.exec("DELETE FROM playlist_chat_jobs WHERE status IN ('queued','running');DELETE FROM playlist_inference_queue;DELETE FROM playlist_inference_slot");
  const listenerReplay=process.env.PLAYLIST_EVAL_LISTENER_REPLAY;
  let snapshot:ListenerSnapshot;
  if(listenerReplay){
    const prior=JSON.parse(readFileSync(listenerReplay,'utf8'));
    const stored=database.prepare('SELECT songs_json,complete,identity_version FROM listener_music_snapshots WHERE owner_user_id=?').get(owner.id) as {songs_json:string;complete:number;identity_version:number}|undefined;
    if(prior.fixtureHash!==baseline.fixtureHash||prior.listener.ownerId!==owner.id||!prior.listener.complete||!stored?.complete||stored.identity_version!==3||createHash('sha256').update(stored.songs_json).digest('hex')!==prior.listener.hash)throw Error('Frozen listening replay does not match the original owner, fixture and exact native snapshot');
    snapshot={songs:JSON.parse(stored.songs_json),complete:true,stale:false,capturedAt:prior.listener.capturedAt,error:'',available:true};
    if(snapshot.songs.length!==prior.listener.songs)throw Error('Frozen listening replay count differs');
  }else snapshot=await listenerMusicSnapshot(owner.id);
  if(!snapshot.complete||snapshot.stale)throw Error('A complete valid listener snapshot is required for this evaluation');
  const source=new Database('/app/data/curator.sqlite',{readonly:true,fileMustExist:true});
  const client=new CuratorAiClient({apiKey:config.CURATOR_AI_API_KEY,baseURL:config.CURATOR_AI_BASE_URL,model:aiModel,
    runCompletion:async(operation,signal)=>{
      const busy=()=>Boolean(source.prepare("SELECT 1 FROM playlist_chat_jobs WHERE status IN ('queued','running') LIMIT 1").get());
      if(busy())throw new InferenceYieldError('Read-only evaluation yielded to production chat');
      const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
      const timer=setInterval(()=>{if(busy())controller.abort(new InferenceYieldError('Read-only evaluation yielded to production chat'))},500);
      try{return await operation(combined)}finally{clearInterval(timer)}
    },
  });
  const selected=process.env.PLAYLIST_EVAL_CASE_IDS?.split(','),scenarios=playlistIntentCases.filter(scenario=>!selected||selected.includes(scenario.id));
  if(!scenarios.length)throw Error('No evaluation scenarios selected');
  const repeats=Math.min(3,Math.max(1,Number(process.env.PLAYLIST_EVAL_REPEATS??3))),output=process.env.PLAYLIST_EVAL_OUTPUT??'/tmp/curator-renewal-eval-code/results';mkdirSync(output,{recursive:true});
  const report:{at:string;scope:string;fixtureHash:string;listener:Record<string,unknown>;runs:Array<Record<string,unknown>>;summary?:Record<string,unknown>}={at:new Date().toISOString(),scope:'Read-only production inputs; temporary database copy only; no publication/acquisition. Initial, real chat correction and saved-intent nightly stages.',fixtureHash:baseline.fixtureHash,
    listener:{ownerId:owner.id,complete:snapshot.complete,capturedAt:snapshot.capturedAt,songs:snapshot.songs.length,hash:createHash('sha256').update(JSON.stringify(snapshot.songs)).digest('hex'),...(listenerReplay?{replayedFrom:listenerReplay,evidenceScope:'Frozen previously complete observed history; not a current production freshness claim'}:{})},runs:[]};
  const referenceDefinition=createPlaylist({name:'EVAL reference pool '+Date.now(),category:'depth',enabled:false,ownerUserId:owner.id,config:{...defaultConfig('depth'),targetTracks:12}});
  const referencePool=loadEvidencedCandidates(referenceDefinition,snapshot);
  const persistChat=(playlistId:number,message:string,result:ChatResult)=>{
    const state=chatState(playlistId),lease=acquireChatLease(playlistId);
    try{storeChatResult(playlistId,lease,[...state.messages,{role:'user',content:message},{role:'assistant',content:result.reply}],result)}finally{releaseChatLease(playlistId,lease)}
  };
  const evaluate=async(scenario:typeof scenarios[number],repeat:number,stage:'initial'|'correction'|'nightly',playlist:PlaylistDefinition,previous:EvidencedCandidate[]=[])=>{
    const started=Date.now(),oracleOptions={stage,previous,snapshot,now:Date.parse(report.at),available:referencePool};
    const independentlyEligible=independentEligibleCount(scenario.id,referencePool,oracleOptions);
    try{
      let generated:Awaited<ReturnType<typeof generateIntentSelection>>;
      if(scenario.category==='chat'&&stage!=='nightly'){
        const message=stage==='initial'?scenario.prompt:scenario.correction!;
        const selection=await suggestIntentChatPlaylist(playlist,chatState(playlist.id),message,scenario.target,{client,snapshot});
        persistChat(playlist.id,message,selection.result);generated=selection.generated;
      }else generated=await generateIntentSelection(playlist,{client,snapshot});
      const violations=scenarioViolations(scenario.id,generated.items,oracleOptions),nativeIds=generated.items.map(track=>track.songId);
      if(new Set(nativeIds).size!==nativeIds.length||nativeIds.some(id=>!id))violations.push('Missing or duplicate native song identity');
      const sufficient=independentlyEligible>=scenario.target;
      const valid=!violations.length&&!generated.evaluation.violations.length&&(!sufficient||generated.items.length===scenario.target);
      if(stage==='nightly'&&previous.length===scenario.target&&!generated.evaluation.shortage){
        const expected=Math.round(scenario.target*playlist.config.rotationPercent/100),keys=new Set(previous.map(track=>track.evidence.recordingKey));
        const changed=generated.items.filter(track=>!keys.has(track.evidence.recordingKey)).length;
        if(Math.abs(changed-expected)>1)violations.push('Nightly rotation outside one-song tolerance');
      }
      const result={scenario:scenario.id,repeat,stage,playlistId:playlist.id,durationMs:Date.now()-started,sufficient,independentlyEligible,valid:valid&&!violations.length,independentViolations:violations,
        intent:generated.intent,evaluation:generated.evaluation,detail:generated.detail,items:generated.items.map(track=>({fileId:track.fileId,songId:track.songId,artist:track.artist,title:track.title,album:track.album,year:track.year,reason:track.reason,recordingKey:track.evidence.recordingKey}))};
      report.runs.push(result);console.log(JSON.stringify({scenario:scenario.id,repeat,stage,durationMs:result.durationMs,valid:result.valid,sufficient,count:generated.items.length,violations}));
      return generated.items;
    }catch(error){
      const result={scenario:scenario.id,repeat,stage,playlistId:playlist.id,durationMs:Date.now()-started,sufficient:independentlyEligible>=scenario.target,independentlyEligible,error:String(error)};
      report.runs.push(result);console.log(JSON.stringify(result));return null;
    }finally{writeFileSync(output+'/report.json',JSON.stringify(report,null,2))}
  };
  try{
    for(const scenario of scenarios)for(let repeat=1;repeat<=repeats;repeat++){
      const playlist=createPlaylist({name:`EVAL ${scenario.id} ${repeat} ${Date.now()}`,category:scenario.category,enabled:false,ownerUserId:owner.id,intent:scenario.category==='chat'?'':scenario.prompt,config:{...defaultConfig(scenario.category),targetTracks:scenario.target}});
      const initial=await evaluate(scenario,repeat,'initial',playlist);
      if(initial&&scenario.correction){
        const corrected=await evaluate(scenario,repeat,'correction',playlist,initial);
        if(corrected)await evaluate(scenario,repeat,'nightly',playlist,corrected);
      }
    }
    const sufficient=report.runs.filter(run=>run.sufficient),valid=sufficient.filter(run=>run.valid);
    const errors=report.runs.filter(run=>run.error).length,unknown=report.runs.filter(run=>run.sufficient==null).length;
    report.summary={scenarioRuns:report.runs.length,sufficient:sufficient.length,validWhereSufficient:valid.length,rateForKnownSufficientOnly:sufficient.length?valid.length/sufficient.length*100:null,
      conservativeSuccessPercentage:sufficient.length+unknown?valid.length/(sufficient.length+unknown)*100:null,unknownSufficiency:unknown,
      errors,hardViolations:report.runs.reduce((sum,run)=>sum+((run.independentViolations as string[]|undefined)??[]).length,0),published:0,correctionRuns:report.runs.filter(run=>run.stage==='correction').length,nightlyChatRuns:report.runs.filter(run=>run.stage==='nightly').length};
    writeFileSync(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary));
  }finally{source.close();database.close()}
}
void main().catch(error=>{console.error(String(error));process.exitCode=1});
