import {writeFileSync,mkdirSync} from 'node:fs';
import {config} from '../src/config';
import {db} from '../src/features/db/client';
import {getPlaylist} from '../src/features/playlists/repository';
import {listenerMusicSnapshot} from '../src/features/playlists/listening-snapshot';
import {loadEvidencedCandidates} from '../src/features/playlists/selection-repository';
import {reviewIdentity,reviewIdentityHash} from '../src/features/playlists/metadata-review';
import {recordReviewedTrackFacts} from '../src/features/playlists/reviewed-track-facts';
import {playlistTrackEvidence} from '../src/features/playlists/evidence-repository';
import {discoveryPage} from '../src/features/playlists/discovery-sources';
import {configuredIntent} from '../src/features/playlists/intent-schema';
import {assessCandidate} from '../src/features/playlists/selection-policy';

async function main(){
  if(!config.DATABASE_PATH.startsWith('/tmp/curator-renewal-eval-')&&!(config.DATABASE_PATH==='/app/data/curator.sqlite'&&process.env.PLAYLIST_APPLY_REVIEWED_FACTS==='true'))throw Error('Requires the private evaluation copy or explicit production source-review mode');
  const database=db(),owner=database.prepare("SELECT id FROM curator_users WHERE username='busykoala'").get() as {id:number},definition=getPlaylist(6);
  if(!definition||definition.ownerUserId!==owner.id)throw Error('Expected the existing canary owner');
  const snapshot=await listenerMusicSnapshot(owner.id);if(!snapshot.complete||snapshot.stale)throw Error('A current complete native snapshot is required');
  const pool=loadEvidencedCandidates(definition,snapshot),matches=pool.filter(track=>track.artist==='Green Day'&&track.title.toLowerCase()==='song of the century'&&track.album==='21st Century Breakdown');
  if(matches.length!==1)throw Error('The known studio example is missing or ambiguous');
  const track=matches[0],row=database.prepare('SELECT id,artist_name,tags_json,properties_json FROM files WHERE id=?').get(track.fileId) as Parameters<typeof reviewIdentity>[0],identity=reviewIdentity(row);
  if(identity.releaseGroupId!=='37608ff2-3168-3e7c-a77e-04a4b7300c1b'||Math.abs(identity.durationMs-57773)>2000)throw Error('The known review does not bind this edition/performance');
  const url='https://trouserpress.com/reviews/green-day/',page=await discoveryPage('metadata-editorial',url),quote='a cappella number (“Song of the Century”)';
  const intent=configuredIntent({...definition,category:'depth',config:{...definition.config,genres:['rock'],tasteLanes:[],moods:[],contexts:[]}},'source-review');intent.hard.requirements.push({field:'instrumentation',values:['guitar'],match:'all'});
  const assessmentDefinition={...definition,category:'depth' as const,config:{...definition.config,genres:['rock'],tasteLanes:[],moods:[],contexts:[]}};
  const before=playlistTrackEvidence(track.fileId)!,beforeAssessment=assessCandidate({...track,evidence:before},assessmentDefinition,intent,snapshot);
  const applied=recordReviewedTrackFacts(track.fileId,reviewIdentityHash(identity),{url,artist:track.artist,title:track.title,album:track.album,quote,text:page.value.title+' '+page.value.text,retrievedAt:page.fetchedAt,facts:[{field:'instrumentation',value:['voice'],scope:'recording',url},{field:'vocalPresence',value:true,scope:'recording',url}]});
  const after=playlistTrackEvidence(track.fileId)!,afterAssessment=assessCandidate({...track,evidence:after},assessmentDefinition,intent,snapshot);
  if(afterAssessment.eligible)throw Error('The source-corrected a cappella recording still satisfies a guitar requirement');
  const output=process.env.PLAYLIST_EVAL_OUTPUT??'/tmp/curator-renewal-eval-code/track-review';mkdirSync(output,{recursive:true});
  const report={at:new Date().toISOString(),scope:'Targeted evidence correction only: native identity and exact studio release/duration verified; no tag/profile rewrite, playlist publication or acquisition.',fileId:track.fileId,artist:track.artist,title:track.title,album:track.album,nativeId:track.songId,source:{url,retrievedAt:page.fetchedAt,supportedClaim:quote},applied,before:{instrumentation:before.fields.instrumentation,guitarEligible:beforeAssessment.eligible},after:{instrumentation:after.fields.instrumentation,guitarEligible:afterAssessment.eligible},tagOrProfileWrites:0};
  writeFileSync(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({applied,fileId:track.fileId,beforeGuitarEligible:beforeAssessment.eligible,afterGuitarEligible:afterAssessment.eligible,tagOrProfileWrites:0}));database.close();
}
void main().catch(error=>{console.error(String(error));process.exitCode=1});
