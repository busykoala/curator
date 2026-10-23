import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {config} from '../src/config';
import {db} from '../src/features/db/client';
import {getPlaylist} from '../src/features/playlists/repository';
import {loadEvidencedCandidates} from '../src/features/playlists/selection-repository';
import {selectPlaylist,assessCandidate,type EvidencedCandidate} from '../src/features/playlists/selection-policy';
import {selectionRecordingKey} from '../src/features/playlists/recording-groups';
import {discoveryDirection} from '../src/features/playlists/discovery-directions';
import {scenarioViolations,scenarioRetentionLocks} from '../src/features/playlists/evaluation-oracle';
import type {PlaylistIntent} from '../src/features/playlists/intent-schema';
import type {ListenerSnapshot} from '../src/features/playlists/listening-snapshot';

async function main(){
  const target=process.env.PLAYLIST_EVAL_DB_PATH;
  if(!target?.startsWith('/tmp/curator-renewal-eval-')||config.DATABASE_PATH!==target)throw Error('Requires the explicitly supplied private evaluation database');
  const input=process.env.PLAYLIST_EVAL_REPLAY;if(!input)throw Error('Supply the completed live replay report');
  const replay=JSON.parse(readFileSync(input,'utf8')),database=db();
  const stored=database.prepare('SELECT songs_json,captured_at,complete FROM listener_music_snapshots WHERE owner_user_id=?').get(replay.listener.ownerId) as {songs_json:string;captured_at:string;complete:number};
  if(!stored||!stored.complete||createHash('sha256').update(stored.songs_json).digest('hex')!==replay.listener.hash)throw Error('Listener snapshot differs from the live replay; refusing a misleading comparison');
  const snapshot:ListenerSnapshot={songs:JSON.parse(stored.songs_json),capturedAt:stored.captured_at,complete:true,stale:false,error:'',available:true};
  const results:Array<Record<string,unknown>>=[],seen=new Set<string>(),day=86400_000,start=Date.parse(replay.at);
  const output=process.env.PLAYLIST_EVAL_OUTPUT??'/tmp/curator-renewal-eval-code/simulation';mkdirSync(output,{recursive:true});
  let inputReplay=replay;
  const persist=()=>{
    const all=results.flatMap(result=>result.nights as Array<{violations:string[];published:boolean}>);
    const report={at:new Date().toISOString(),fixtureHash:replay.fixtureHash,listenerHash:replay.listener.hash,replayComplete:Boolean(inputReplay.summary),scope:'Simulation only. Frozen real playable library, real compiled intents and observed listener snapshot. No listening, native publication or acquisition. Only hypothetical exposure/removal evolves; initial seven-day exposure is retained conservatively for seven days.',results,summary:{cases:results.length,simulatedNights:all.length,publishable:all.filter(night=>night.published).length,violations:all.reduce((n,night)=>n+night.violations.length,0),completeInput:Boolean(inputReplay.summary)}};
    writeFileSync(output+'/report.json',JSON.stringify(report,null,2));return report;
  };
  for(;;){
  for(const run of inputReplay.runs){
    const identity=run.scenario+':'+run.stage;if(seen.has(identity)||run.error||!run.intent)continue;seen.add(identity);
    const definition=getPlaylist(run.playlistId);if(!definition)throw Error('Replay playlist configuration missing');
    const intent=run.intent as PlaylistIntent,base=loadEvidencedCandidates(definition,snapshot);
    if(definition.category==='discovery')for(const track of base)Object.assign(track,discoveryDirection(track,intent));
    const byId=new Map(base.map(track=>[track.fileId,track]));
    const original=inputReplay.runs.find((candidate:typeof run)=>candidate.scenario===run.scenario&&candidate.repeat===run.repeat&&candidate.stage==='initial');
    if(!original)throw Error('The original selection for a replay stage is missing');
    const retentionReference=scenarioRetentionLocks(run.scenario,original.items.map((item:{fileId:number})=>byId.get(item.fileId)).filter(Boolean));
    let previous:EvidencedCandidate[]=run.items.map((item:{fileId:number})=>byId.get(item.fileId)).filter(Boolean);
    const removed=new Map<string,number>(),exposures=new Map<string,number[]>(),nights:Array<Record<string,unknown>>=[];
    for(let night=1;night<=14;night++){
      const now=start+night*day,pool=base.map(track=>({...track,
        exposureCount:(night<=7?track.exposureCount:0)+(exposures.get(selectionRecordingKey(track))??[]).filter(at=>now-at<=7*day).length,
        removedAt:Math.max(track.removedAt??0,removed.get(selectionRecordingKey(track))??0)||null,
      }));
      const priorKeys=new Set(previous.map(selectionRecordingKey)),eligible=pool.filter(track=>assessCandidate(track,definition,intent,snapshot,now).eligible),eligibleKeys=new Set(eligible.map(selectionRecordingKey));
      const validPins=new Set(intent.pinnedRecordings.filter(pin=>eligible.some(track=>track.fileId===pin.fileId)).map(pin=>pin.fileId));for(const lock of intent.positionLocks)if(eligible.some(track=>track.fileId===lock.fileId))validPins.add(lock.fileId);
      const replacements=new Set(eligible.filter(track=>!priorKeys.has(selectionRecordingKey(track))&&!(track.removedAt&&now-track.removedAt<14*day)).map(selectionRecordingKey));
      const requested=Math.round(definition.config.targetTracks*definition.config.rotationPercent/100),pinLimited=Math.min(requested,definition.config.targetTracks-validPins.size);
      const result=selectPlaylist({definition,intent,pool,previous,snapshot,now,seed:'simulation:'+night}),violations=[...result.evaluation.violations];
      let published=false;
      if(!result.evaluation.shortage){
        const keys=new Set(result.items.map(selectionRecordingKey)),changed=result.items.filter(track=>!priorKeys.has(selectionRecordingKey(track))).length;
        for(const track of result.items)if(!priorKeys.has(selectionRecordingKey(track))&&removed.has(selectionRecordingKey(track))&&now-removed.get(selectionRecordingKey(track))!<14*day)violations.push('Removed recording re-entered its fourteen-day cooldown');
        if(eligibleKeys.size>=definition.config.targetTracks&&replacements.size>=pinLimited&&previous.length===definition.config.targetTracks&&Math.abs(changed-pinLimited)>1)violations.push('Configured feasible rotation exceeded one-song tolerance');
        violations.push(...scenarioViolations(run.scenario,result.items,{stage:run.stage,previous,retentionReference,snapshot,now,available:pool}));
        if(!violations.length){published=true;for(const track of previous)if(!keys.has(selectionRecordingKey(track)))removed.set(selectionRecordingKey(track),now);for(const track of result.items)exposures.set(selectionRecordingKey(track),[...(exposures.get(selectionRecordingKey(track))??[]),now]);previous=result.items}
      }
      const proposed=result.items.map(track=>({fileId:track.fileId,artist:track.artist,title:track.title,album:track.album,recordingKey:selectionRecordingKey(track),adjacent:Boolean(track.adjacent),adjacencyReason:track.adjacencyReason,genre:track.evidence.fields.genre,style:track.evidence.fields.style,reason:track.reason}));
      nights.push({proposed,night,at:new Date(now).toISOString(),published,retainedPrevious:!published,count:previous.length,eligible:eligibleKeys.size,availableReplacements:replacements.size,requestedReplacements:requested,pinLimitedReplacements:pinLimited,evaluation:result.evaluation,violations});
    }
    results.push({scenario:run.scenario,stage:run.stage,category:definition.category,target:definition.config.targetTracks,nights});
    persist();console.log(JSON.stringify({scenario:run.scenario,stage:run.stage,nights:nights.length,violations:nights.reduce((n,night)=>n+(night.violations as string[]).length,0)}));
  }
  if(process.env.PLAYLIST_SIMULATION_WATCH!=='true'||inputReplay.summary)break;
  await delay(10_000);
  let newest:typeof replay|undefined;
  for(let attempt=0;attempt<20;attempt++){
    try{newest=JSON.parse(readFileSync(input,'utf8'));break}catch(error){if(!(error instanceof SyntaxError)||attempt===19)throw error;await delay(100)}
  }
  if(!newest||newest.fixtureHash!==replay.fixtureHash||newest.listener.hash!==replay.listener.hash||newest.at!==replay.at)throw Error('Replay inputs changed during simulation; refusing to mix different evaluations');
  inputReplay=newest;
  }
  console.log(JSON.stringify(persist().summary));database.close();
}
void main().catch(error=>{console.error(String(error));process.exitCode=1});
