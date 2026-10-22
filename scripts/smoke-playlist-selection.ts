import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {CuratorAiClient,type AiAttempt} from '../src/features/ai/client';
import {defaultConfig,type PlaylistDefinition} from '../src/features/playlists/types';
import {configuredIntent,canonicalIntent} from '../src/features/playlists/intent-schema';
import {buildTrackEvidence} from '../src/features/playlists/track-evidence';
import {assessCandidate,selectPlaylist,type EvidencedCandidate} from '../src/features/playlists/selection-policy';
import {choosePlaylistAdditions} from '../src/features/playlists/selection-agent';

// A narrow template/tool smoke test. This is deliberately NOT the 24×3
// end-to-end acceptance evaluation: history and native identities are not
// supplied, and the intent is fixed rather than compiled by the live model.
async function main(){
  const kubeconfig=process.env.PLAYLIST_EVAL_KUBECONFIG;if(!kubeconfig)throw Error('Set PLAYLIST_EVAL_KUBECONFIG to read the existing cluster AI credential');
  const secret=JSON.parse(execFileSync('kubectl',['--kubeconfig',kubeconfig,'-n','music-server','get','secret','music-server-secrets','-o','json'],{encoding:'utf8'}));
  const key=Buffer.from(secret.data.CURATOR_AI_API_KEY,'base64').toString('utf8');
  const client=new CuratorAiClient({apiKey:key,baseURL:process.env.PLAYLIST_EVAL_AI_URL??'https://inference.blizzard.busykoala.io/v1',model:'curator'});
  const baseline=process.env.PLAYLIST_EVAL_FIXTURE??'delivery/playlist-renewal/baseline/production-current-selections.json';
  const fixture=JSON.parse(await readFile(baseline,'utf8'));
  const definition={id:6,category:'discovery',name:'Melodic Techno Radar smoke',ownerUserId:3,intent:'Melodic techno and ambient techno. Hypnotic rather than festival EDM.',
    config:{...defaultConfig('discovery'),targetTracks:12,genres:['electronic'],tasteLanes:['melodic_techno','ambient_techno']}} as PlaylistDefinition;
  const intent=canonicalIntent(configuredIntent(definition,'fixed-smoke-v1'));intent.hard.exclusions=['festival_edm','big_room'];
  const snapshot={complete:false,stale:true},byRecording=new Map<string,EvidencedCandidate>();
  for(const raw of fixture.fixture.tracks){
    const evidence=buildTrackEvidence({artist:raw.artist,title:raw.title,profile:raw.profile,tags:raw.tags,provenance:raw.provenance});
    const track:EvidencedCandidate={...raw,evidence,songId:'',listener:null,exposureCount:0,removedAt:null,score:0,reason:'',origin:'catalog'};
    const assessment=assessCandidate(track,definition,intent,snapshot);
    if(assessment.eligible&&!byRecording.has(evidence.recordingKey))byRecording.set(evidence.recordingKey,{...track,score:assessment.score,reason:assessment.reasons.join(' · ')});
  }
  const ranked=[...byRecording.values()].sort((a,b)=>b.score-a.score||a.fileId-b.fileId);
  const plan=selectPlaylist({definition,intent,pool:ranked,previous:[],snapshot}),proposed=plan.items;
  const proposedIds=new Set(proposed.map(track=>track.fileId)),candidates=[...proposed,...ranked.filter(track=>!proposedIds.has(track.fileId))].slice(0,60);
  if(candidates.length<12)throw Error(`Only ${candidates.length} matching recordings in the fixed fixture; smoke needs 12`);
  const attempts:AiAttempt[]=[],started=Date.now();
  const result=await choosePlaylistAdditions({client,intent,candidates,target:12,listenerContext:{complete:false,stale:true,note:'No listener history supplied. Unheard status must not be claimed.'},retainedArtists:[],limits:{maxPerArtist:plan.evaluation.diversityLimits!.artist,maxPerAlbum:plan.evaluation.diversityLimits!.album,retained:[]},signal:AbortSignal.timeout(240_000),repairBudget:{remaining:1},onAttempt:attempt=>attempts.push(attempt)});
  const checks={requestedSize:result.items.length===12,uniqueRecordings:new Set(result.items.map(item=>item.evidence.recordingKey)).size===12,
    eligible:result.items.every(track=>assessCandidate(track,definition,intent,snapshot).eligible),toolsUsed:result.detail.tools.some(tool=>tool.name==='search_library'),
    artistVariety:result.items.every(track=>result.items.filter(other=>other.artist===track.artist).length<=plan.evaluation.diversityLimits!.artist),
    albumVariety:result.items.every(track=>result.items.filter(other=>other.artist===track.artist&&other.album===track.album).length<=plan.evaluation.diversityLimits!.album)};
  const report={at:new Date().toISOString(),scope:'Live selection-stage smoke only; fixed intent, existing model metadata, no listening history, no native playability proof, no publication',fixture:baseline,
    fixtureHash:fixture.fixtureHash,model:'curator',planEvaluation:plan.evaluation,durationMs:Date.now()-started,checks,attempts,...result};
  const output='delivery/playlist-renewal/live-smoke';await mkdir(output,{recursive:true});await writeFile(output+'/selection-techno.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({durationMs:report.durationMs,checks,usage:result.detail.usage,repair:result.detail.repair,tools:result.detail.tools.map(tool=>tool.name),songs:result.items.map(item=>`${item.artist} — ${item.title}`)}));
  if(Object.values(checks).some(passed=>!passed))process.exitCode=1;
}
void main().catch(async error=>{const output='delivery/playlist-renewal/live-smoke';await mkdir(output,{recursive:true});await writeFile(output+'/selection-techno-failure.json',JSON.stringify({at:new Date().toISOString(),error:String(error),scope:'Selection-stage smoke failure; no publication'},null,2));console.error(String(error));process.exitCode=1});
