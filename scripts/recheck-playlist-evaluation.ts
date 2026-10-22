import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {config} from '../src/config';
import {db} from '../src/features/db/client';
import {getPlaylist} from '../src/features/playlists/repository';
import {loadEvidencedCandidates} from '../src/features/playlists/selection-repository';
import {scenarioViolations,independentEligibleCount} from '../src/features/playlists/evaluation-oracle';
import type {ListenerSnapshot,ListenerSong} from '../src/features/playlists/listening-snapshot';
import type {EvidencedCandidate} from '../src/features/playlists/selection-policy';
function main(){
  const target=process.env.PLAYLIST_EVAL_DB_PATH,input=process.env.PLAYLIST_EVAL_INPUT,output=process.env.PLAYLIST_EVAL_RECHECK_OUTPUT;
  if(!target?.startsWith('/tmp/curator-renewal-eval-')||config.DATABASE_PATH!==target||!input||!output)throw Error('Requires the isolated evaluation database, an existing replay report and an explicit output path');
  const report=JSON.parse(readFileSync(input,'utf8')),database=db();
  try{
    const row=database.prepare('SELECT songs_json,captured_at FROM listener_music_snapshots WHERE owner_user_id=?').get(report.listener.ownerId) as {songs_json:string;captured_at:number};
    const songs=JSON.parse(row.songs_json) as ListenerSong[];
    if(createHash('sha256').update(JSON.stringify(songs)).digest('hex')!==report.listener.hash)throw Error('Listening evidence differs from the replay; refusing a post-hoc comparison');
    const snapshot:ListenerSnapshot={songs,complete:true,stale:false,available:true,capturedAt:new Date(row.captured_at).toISOString(),error:''};
    const previous=new Map<number,EvidencedCandidate[]>(),pools=new Map<number,EvidencedCandidate[]>(),runs:Array<Record<string,unknown>>=[];
    for(const run of report.runs){
      const definition=getPlaylist(run.playlistId);if(!definition)throw Error('Replay playlist no longer exists in the copy');
      let pool=pools.get(definition.ownerUserId);if(!pool){pool=loadEvidencedCandidates(definition,snapshot);pools.set(definition.ownerUserId,pool)}
      const byId=new Map(pool.map(track=>[track.fileId,track]));
      const items:EvidencedCandidate[]=(run.items??[]).flatMap((item:{fileId:number})=>{const track=byId.get(item.fileId);return track?[track]:[]});
      const options={stage:run.stage,previous:previous.get(run.playlistId)??[],snapshot,now:Date.parse(report.at),available:pool};
      const violations=scenarioViolations(run.scenario,items,options),eligible=independentEligibleCount(run.scenario,pool,options),sufficient=eligible>=definition.config.targetTracks;
      if(items.length!==(run.items??[]).length)violations.push('Replay native identity cannot be reconstructed');
      if(run.error)violations.push('Original replay failed: '+run.error);
      if(sufficient&&items.length!==definition.config.targetTracks)violations.push('Unexplained shortage');
      if(run.evaluation?.violations?.length)violations.push(...run.evaluation.violations);
      runs.push({scenario:run.scenario,repeat:run.repeat,stage:run.stage,originalValid:run.valid,valid:!violations.length,sufficient,independentlyEligible:eligible,violations,
        observedGenres:items.map(track=>({fileId:track.fileId,genre:track.evidence.fields.genre?.value,style:track.evidence.fields.style?.value}))});
      previous.set(run.playlistId,items);
    }
    const result={at:new Date().toISOString(),scope:'Post-hoc independent-oracle audit of the exact saved model outputs and listening snapshot; no model rerun, publication or acquisition. Does not replace the final acceptance replays.',inputHash:createHash('sha256').update(readFileSync(input)).digest('hex'),fixtureHash:report.fixtureHash,listenerHash:report.listener.hash,runs,
      summary:{runs:runs.length,valid:runs.filter(run=>run.valid).length,violations:runs.reduce((sum,run)=>sum+(run.violations as string[]).length,0)}};
    writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result.summary));
  }finally{database.close()}
}
try{main()}catch(error){console.error(String(error));process.exitCode=1}
