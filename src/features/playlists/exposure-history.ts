import {db} from '@/features/db/client';
import {playlistTrackEvidence} from './evidence-repository';
import {fallbackRecordingKey,type TrackEvidenceView} from './track-evidence';
type Exposure={run_id:number;file_id:number;recording_key:string;fallback_key:string;exposed_at:number;removed_at:number|null};
const fileAlias=(fileId:number,fallback:string)=>`file:${fileId}:${fallback.slice(0,fallback.lastIndexOf('|'))}`;
export const exposureIdentityKeys=(fileId:number,recordingKey:string,fallback:string)=>[recordingKey,fallback,fallback?fileAlias(fileId,fallback):''].filter(Boolean);
export function rememberExposureFallback(runId:number,fileId:number,artist:string,title:string,evidence:TrackEvidenceView){
  db().prepare('UPDATE playlist_recording_exposure SET fallback_key=? WHERE run_id=? AND file_id=?').run(fallbackRecordingKey(artist,title,evidence.fields),runId,fileId);
}
export function ownerRecordingExposure(ownerId:number,now=Date.now()){
  const rows=db().prepare(`SELECT run_id,file_id,recording_key,fallback_key,exposed_at,removed_at FROM playlist_recording_exposure WHERE owner_user_id=?
    AND (exposed_at>=? OR removed_at>=? OR removed_at IS NULL)`).all(ownerId,now-14*86400_000,now-14*86400_000) as Exposure[];
  const aliases=new Map<string,Set<Exposure>>();
  for(const row of rows){
    if(!row.fallback_key){
      const file=db().prepare('SELECT artist_name,tags_json FROM files WHERE id=?').get(row.file_id) as {artist_name:string;tags_json:string}|undefined,evidence=file?playlistTrackEvidence(row.file_id):null;
      if(file&&evidence){const tags=JSON.parse(file.tags_json);row.fallback_key=fallbackRecordingKey(file.artist_name,String(Array.isArray(tags.title)?tags.title[0]:tags.title??''),evidence.fields);db().prepare('UPDATE playlist_recording_exposure SET fallback_key=? WHERE run_id=? AND file_id=?').run(row.fallback_key,row.run_id,row.file_id)}
    }
    for(const key of new Set(exposureIdentityKeys(row.file_id,row.recording_key,row.fallback_key))){if(!aliases.has(key))aliases.set(key,new Set());aliases.get(key)!.add(row)}
  }
  return(fileId:number,artist:string,title:string,evidence:TrackEvidenceView)=>{
    const events=new Set<Exposure>();
    const fallback=fallbackRecordingKey(artist,title,evidence.fields);
    for(const key of exposureIdentityKeys(fileId,evidence.recordingKey,fallback))for(const event of aliases.get(key)??[])events.add(event);
    return{exposure_count:[...events].filter(event=>event.exposed_at>=now-7*86400_000).length,removed_at:Math.max(0,...[...events].map(event=>event.removed_at??0))||null};
  };
}
