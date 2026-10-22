import {db} from '@/features/db/client';
import {buildTrackEvidence,trackEvidenceHash,trackEvidenceVersion,type ExternalTrackFact,type TrackEvidenceView} from './track-evidence';
import {reviewIdentity,reviewIdentityHash} from './metadata-review';
import {reviewedTrackFacts} from './reviewed-track-facts';

export function playlistTrackEvidence(fileId:number):TrackEvidenceView|null{
  const row=db().prepare(`SELECT f.id,f.artist_name,f.album_key,f.tags_json,f.properties_json,p.profile_json,p.provenance_json,o.patch_json,m.release_group_mbid,a.features_json
    FROM files f LEFT JOIN track_profiles p ON p.file_id=f.id LEFT JOIN track_profile_overrides o ON o.file_id=f.id
    LEFT JOIN manual_overrides m ON m.album_key=f.album_key AND m.confirmed=1 LEFT JOIN audio_features a ON a.file_id=f.id WHERE f.id=?`).get(fileId) as
    {id:number;artist_name:string;album_key:string;tags_json:string;properties_json:string;profile_json:string|null;provenance_json:string|null;patch_json:string|null;release_group_mbid:string|null;features_json:string|null}|undefined;
  if(!row)return null;
  const tags=JSON.parse(row.tags_json),external:ExternalTrackFact[]=[];
  external.push(...reviewedTrackFacts(fileId,reviewIdentityHash(reviewIdentity(row))));
  const reviewed=db().prepare("SELECT facts_json FROM playlist_metadata_reviews WHERE file_id=? AND source_hash=? AND status='complete'").get(fileId,reviewIdentityHash(reviewIdentity(row))) as {facts_json:string}|undefined;
  if(reviewed)external.push(...JSON.parse(reviewed.facts_json));
  const groupId=row.release_group_mbid??Object.entries(tags).filter(([k])=>k.toLowerCase().replace(/[^a-z]/g,'')==='musicbrainzreleasegroupid').flatMap(([,v])=>Array.isArray(v)?v:[v])[0];
  if(groupId){
    const sources=db().prepare("SELECT payload_json FROM evidence WHERE entity_key=? AND provider='musicbrainz' ORDER BY fetched_at DESC LIMIT 8").all(row.album_key) as Array<{payload_json:string}>;
    for(const source of sources){
      const payload=JSON.parse(source.payload_json),groups=[payload,...(payload['release-groups']??[])];
      const group=groups.find(g=>g.id===groupId);if(!group)continue;
      const date=group['first-release-date'];
      // A compilation's first issue date says nothing about the original era
      // of its component recordings. Preserve edition dates separately.
      if(date&&!(group['secondary-types']??[]).includes('Compilation'))external.push({field:'originalDate',value:date,scope:'release',url:`https://musicbrainz.org/release-group/${groupId}`});
      break;
    }
  }
  const input={artist:row.artist_name,title:String(Array.isArray(tags.title)?tags.title[0]:tags.title??''),tags,profile:JSON.parse(row.profile_json??'{}'),manual:JSON.parse(row.patch_json??'{}'),provenance:JSON.parse(row.provenance_json??'{}'),audio:JSON.parse(row.features_json??'{}'),external};
  const hash=trackEvidenceHash(input),cached=db().prepare('SELECT evidence_json FROM playlist_track_evidence WHERE file_id=? AND version=? AND source_hash=?').get(fileId,trackEvidenceVersion,hash) as {evidence_json:string}|undefined;
  if(cached)return JSON.parse(cached.evidence_json);
  const evidence=buildTrackEvidence(input);
  db().prepare('INSERT INTO playlist_track_evidence(file_id,version,source_hash,evidence_json) VALUES(?,?,?,?) ON CONFLICT(file_id) DO UPDATE SET version=excluded.version,source_hash=excluded.source_hash,evidence_json=excluded.evidence_json,updated_at=CURRENT_TIMESTAMP')
    .run(fileId,trackEvidenceVersion,hash,JSON.stringify(evidence));
  return evidence;
}
