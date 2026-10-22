import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {buildTrackEvidence} from '../src/features/playlists/track-evidence';

async function main(){
const input=process.argv[2]??'delivery/playlist-renewal/baseline/production-current-selections.json';
const output=process.argv[3]??'delivery/playlist-renewal/metadata-audit';
const snapshot=JSON.parse(await readFile(input,'utf8'));
if(snapshot.fixture?.metadataSample?.length!==120)throw Error('Expected the fixed 120-track baseline metadata sample');
const tracks=snapshot.fixture.metadataSample.map((track:Record<string,unknown>)=>{
  const evidence=buildTrackEvidence(track as unknown as Parameters<typeof buildTrackEvidence>[0]);
  const counts:Record<string,number>={};for(const field of Object.values(evidence.fields))counts[field.source]=(counts[field.source]??0)+1;
  return{fileId:track.fileId,artist:track.artist,title:track.title,strata:track.strata,evidence,counts,
    needsTargetedReview:evidence.conflicts.length>0||['instrumentation','vocalProfile'].some(field=>evidence.fields[field]?.source==='model_inference'),
    verification:'Evidence/provenance audit only; musical correctness requires independently supported reference checks.'};
});
await mkdir(output,{recursive:true});
const report={at:new Date().toISOString(),input,fixtureHash:snapshot.fixtureHash,tracks:tracks.length,conflictingTracks:tracks.filter((t:{evidence:{conflicts:string[]}})=>t.evidence.conflicts.length).length,
  scope:'No audio files, tags, profiles, or production data were changed. Uncorroborated model claims are not counted as verified facts.',results:tracks};
await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({tracks:report.tracks,conflictingTracks:report.conflictingTracks,output:join(output,'report.json')}));
}
void main().catch(error=>{console.error(String(error));process.exitCode=1});
