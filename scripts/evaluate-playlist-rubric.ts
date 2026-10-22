import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {config} from '../src/config';
import {db,stateSet} from '../src/features/db/client';
import {CuratorAiClient,aiModel} from '../src/features/ai/client';
import {InferenceYieldError} from '../src/features/ai/scheduler';
import {createPlaylist} from '../src/features/playlists/repository';
import {compilePlaylistIntent} from '../src/features/playlists/intent-compiler';
import {musicalFitFixtures} from '../src/features/playlists/musical-fit-fixtures';
import {musicalFitReferenceCorrections} from '../src/features/playlists/evaluation-cases';
import {selectPlaylist,type EvidencedCandidate} from '../src/features/playlists/selection-policy';
import {withRecordingGroups} from '../src/features/playlists/recording-groups';
import type {PlaylistDefinition} from '../src/features/playlists/types';

async function main(){
  const target=process.env.PLAYLIST_EVAL_DB_PATH;
  if(!target?.startsWith('/tmp/curator-renewal-eval-')||config.DATABASE_PATH!==target)throw Error('Requires the explicitly supplied private evaluation database');
  const legacyPath='/tmp/curator-renewal-eval-code/legacy-reference.mjs',manifest=JSON.parse(readFileSync('/tmp/curator-renewal-eval-code/legacy-manifest.json','utf8'));
  if(createHash('sha256').update(readFileSync(legacyPath)).digest('hex')!==manifest.artifactHash)throw Error('Frozen baseline artifact hash mismatch');
  const {legacySelect}=await import(legacyPath) as {legacySelect:(definition:PlaylistDefinition,pool:EvidencedCandidate[],listening:unknown,prior:number[],pins:number[],excluded:number[],excludedArtists:string[],evaluationTime:number)=>EvidencedCandidate[]};
  const database=db(),source=new Database('/app/data/curator.sqlite',{readonly:true,fileMustExist:true});
  stateSet('paused','false');
  const owner=database.prepare("SELECT id FROM curator_users WHERE username='busykoala'").get() as {id:number};
  const client=new CuratorAiClient({apiKey:config.CURATOR_AI_API_KEY,baseURL:config.CURATOR_AI_BASE_URL,model:aiModel,runCompletion:async(operation,signal)=>{
    const busy=()=>Boolean(source.prepare("SELECT 1 FROM playlist_chat_jobs WHERE status IN ('queued','running') LIMIT 1").get());
    if(busy())throw new InferenceYieldError('Rubric evaluation yielded to production chat');
    const controller=new AbortController(),timer=setInterval(()=>{if(busy())controller.abort(new InferenceYieldError('Rubric evaluation yielded to production chat'))},500);
    try{return await operation(AbortSignal.any([signal,controller.signal]))}finally{clearInterval(timer)}
  }});
  const started=Date.parse('2026-10-22T19:00:00Z'),fixtures=musicalFitFixtures(started),output=process.env.PLAYLIST_EVAL_OUTPUT??'/tmp/curator-renewal-eval-code/rubric';mkdirSync(output,{recursive:true});
  const ids=process.env.PLAYLIST_EVAL_CASE_IDS?.split(',');
  const report:{at:string;scope:string;baseline:unknown;referenceCorrections:unknown;fixtureHash:string;results:Array<Record<string,unknown>>;summary?:unknown}={at:new Date(started).toISOString(),
    scope:'Controlled forty-case rubric: frozen independent positive/negative reference judgments, curated synthetic musical attributes, live local intent compilation and deterministic selection. These are not owned or verified playable library tracks. No native publication/acquisition. This tests fit conditional on the supplied metadata; real-library metadata accuracy is a separate audit.',baseline:manifest,referenceCorrections:musicalFitReferenceCorrections,fixtureHash:createHash('sha256').update(JSON.stringify(fixtures)).digest('hex'),results:[]};
  const passes=(fixture:typeof fixtures[number],items:EvidencedCandidate[],evaluation?:{shortage:number;uncertainty:string[]})=>{
    const selected=new Set(items.map(track=>track.fileId)),mode=fixture.spec.mode;
    if(mode==='stale')return Boolean(evaluation?.uncertainty.some(value=>/unheard.*not established/i.test(value)))&&!items.some(track=>/Unheard in your complete/i.test(track.reason));
    if(mode==='shortage')return items.length===1&&selected.has(fixture.positiveId)&&Boolean(evaluation?.shortage);
    if(mode==='pins')return fixture.previous.every((track,index)=>items[index]?.fileId===track.fileId)&&items.length===fixture.config.targetTracks;
    if(mode==='landing')return items.at(-1)?.fileId===fixture.positiveId&&items.length===fixture.config.targetTracks;
    if(mode==='dedup'||mode==='remix')return items.length===fixture.config.targetTracks&&selected.has(fixture.positiveId)&&!selected.has(fixture.negativeId);
    return selected.has(fixture.positiveId)&&!selected.has(fixture.negativeId);
  };
  try{for(const fixture of fixtures.filter(fixture=>!ids||ids.includes(fixture.rubric.id))){
    const definition=createPlaylist({name:'EVAL rubric '+fixture.rubric.id+' '+Date.now(),category:fixture.spec.category,enabled:false,ownerUserId:owner.id,intent:fixture.direction,config:fixture.config});
    const listening={frequent:fixture.snapshot.songs.filter(song=>song.hasPlayed||song.playCount>0).map(song=>({artist:song.artist,name:song.album,playCount:song.playCount,played:song.lastPlayed})),starred:fixture.snapshot.songs.filter(song=>song.favourite).map(song=>({artist:song.artist,album:song.album}))};
    const evaluationDefinition={...definition,id:fixture.positiveId};
    const old=legacySelect(evaluationDefinition,fixture.pool,listening,fixture.previous.map(track=>track.fileId),[],[],[],started),baselinePass=passes(fixture,old);
    const start=Date.now();
    try{
      const vocabulary:Record<string,string[]>={};for(const track of fixture.pool)for(const[field,evidence]of Object.entries(track.evidence.fields))if(evidence.value!=null)vocabulary[field]=[...new Set([...(vocabulary[field]??[]),...(Array.isArray(evidence.value)?evidence.value.map(String):[String(evidence.value)])])];
      const compiled=await compilePlaylistIntent(definition,fixture.previous,{client,vocabulary,signal:AbortSignal.timeout(120_000)});
      const result=selectPlaylist({definition:evaluationDefinition,intent:compiled.intent,pool:withRecordingGroups(fixture.pool),previous:fixture.previous,snapshot:fixture.snapshot,now:started});
      const pass=!result.evaluation.violations.length&&passes(fixture,result.items,result.evaluation);
      report.results.push({id:fixture.rubric.id,direction:fixture.direction,criterion:fixture.rubric.criterion,positive:fixture.rubric.positive,negative:fixture.rubric.negative,baselinePass,pass,baselineIds:old.map(track=>track.fileId),selectedIds:result.items.map(track=>track.fileId),intent:compiled.intent,evaluation:result.evaluation,latencyMs:Date.now()-start});
      console.log(JSON.stringify({id:fixture.rubric.id,baselinePass,pass,durationMs:Date.now()-start}));
    }catch(error){report.results.push({id:fixture.rubric.id,baselinePass,pass:false,error:String(error),latencyMs:Date.now()-start});console.log(JSON.stringify({id:fixture.rubric.id,error:String(error)}))}
    writeFileSync(output+'/report.json',JSON.stringify(report,null,2));
  }
  const baselinePasses=report.results.filter(result=>result.baselinePass).length,passed=report.results.filter(result=>result.pass).length,total=report.results.length;
  report.summary={cases:total,baselinePasses,passes:passed,baselinePercentage:baselinePasses/total*100,percentage:passed/total*100,improvementPercentagePoints:(passed-baselinePasses)/total*100,completeFixedRubric:total===40,published:0};
  writeFileSync(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary));
  }finally{source.close();database.close()}
}
void main().catch(error=>{console.error(String(error));process.exitCode=1});
