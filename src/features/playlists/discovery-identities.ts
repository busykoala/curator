import {z} from 'zod';
const id=z.string().uuid();
export const musicBrainzCredit=z.object({name:z.string().optional(),artist:z.object({id,name:z.string().min(1)}),joinphrase:z.string().optional()});
export const musicBrainzGroup=z.object({id,title:z.string().min(1),'first-release-date':z.string().optional(),'primary-type':z.string().optional(),'secondary-types':z.array(z.string()).optional(),'artist-credit':z.array(musicBrainzCredit).optional(),genres:z.array(z.object({name:z.string()})).optional(),relations:z.array(z.object({type:z.string(),url:z.object({resource:z.string().url()}).optional()})).optional()});
export const radioRecordings=z.record(z.string(),z.array(z.object({recording_mbid:id,similar_artist_mbid:id,similar_artist_name:z.string().min(1)})));
export const recommendedRecording=z.object({id,title:z.string().min(1),'artist-credit':z.array(musicBrainzCredit).min(1),releases:z.array(z.object({id,status:z.string().optional(),date:z.string().optional(),'release-group':musicBrainzGroup.pick({id:true,title:true,'primary-type':true,'secondary-types':true}).optional()})).optional()});
export function recommendedAlbumGroup(raw:unknown,recordingId:string,artistId:string){
  const recording=recommendedRecording.parse(raw);
  if(recording.id!==recordingId||!recording['artist-credit'].some(credit=>credit.artist.id===artistId))return null;
  const releases=(recording.releases??[]).filter(release=>release.status==='Official'&&release['release-group']?.['primary-type']==='Album'&&
    !(release['release-group']['secondary-types']??[]).some(type=>['Compilation','DJ-mix','Mixtape/Street','Interview'].includes(type)));
  // Prefer a studio album, then an artist live album. A compilation containing
  // the recommended recording does not establish a recommendation of that set.
  releases.sort((a,b)=>Number(Boolean(a['release-group']!['secondary-types']?.includes('Live')))-Number(Boolean(b['release-group']!['secondary-types']?.includes('Live')))||(a.date||'9999').localeCompare(b.date||'9999')||a.id.localeCompare(b.id));
  return releases[0]?.['release-group']?.id??null;
}
