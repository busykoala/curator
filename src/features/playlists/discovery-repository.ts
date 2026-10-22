import {randomUUID} from 'node:crypto';
import {db} from '@/features/db/client';
import type {PlaylistDefinition} from './types';

export type DiscoveryEvidence={provider:string;url:string;fetchedAt:string;scope:'recording'|'release'|'artist';claims:Record<string,string|number|string[]>};
export type DiscoveryRelease={id:string;artistId:string;artist:string;album:string;releaseDate?:string;genres:string[];evidence:DiscoveryEvidence[];identityVerified:boolean};
export type DiscoveryRecommendation={id:number;playlist_id:number;owner_user_id:number;release_id:string;status:string;queued_at:string|null;last_progress_at:string|null;last_size_left:number|null;cooldown_until:string|null;lidarr_album_id:number|null;artist:string;album:string;artist_id:string;release_date:string|null;identity_verified_at:string|null;evidence_json:string;presented_at:string|null;boost_until:string|null};
const columns='SELECT d.*,r.artist,r.album,r.artist_id,r.release_date,r.lidarr_album_id,r.identity_verified_at FROM playlist_discovery_recommendations d JOIN playlist_discovery_releases r ON r.id=d.release_id';
export const discoveryPoolTarget=10;
export function verifiedDiscoveryRecommendation(row:{identity_verified_at:string|null;evidence_json:string}){
  if(!row.identity_verified_at)return false;
  try{const sources=JSON.parse(row.evidence_json);return Array.isArray(sources)&&sources.some(source=>source&&source.provider!=='musicbrainz'&&source.provider!=='official-release'&&typeof source.url==='string'&&source.claims&&Object.keys(source.claims).length>0)}catch{return false}
}
export function discoveryRecommendations(playlistId:number,ownerId:number){
  return db().prepare(columns+' WHERE d.playlist_id=? AND d.owner_user_id=? AND EXISTS (SELECT 1 FROM smart_playlists p WHERE p.id=d.playlist_id AND p.owner_user_id=d.owner_user_id) ORDER BY d.created_at,d.id').all(playlistId,ownerId) as DiscoveryRecommendation[];
}
export function activeDiscoveryRecommendations(){return db().prepare(columns+" WHERE d.status IN ('queued','downloading','deferred','researched') AND EXISTS (SELECT 1 FROM smart_playlists p WHERE p.id=d.playlist_id AND p.owner_user_id=d.owner_user_id)").all() as DiscoveryRecommendation[]}
export function storeDiscoveryRecommendation(playlist:PlaylistDefinition,release:DiscoveryRelease,rationale:string,origin:string){
  if(!release.identityVerified||!release.evidence.length)throw new Error('Discovery requires verified release identity and recommendation evidence');
  return db().transaction(()=>{
    const owner=db().prepare('SELECT owner_user_id FROM smart_playlists WHERE id=?').get(playlist.id) as {owner_user_id:number}|undefined;
    if(owner?.owner_user_id!==playlist.ownerUserId)throw new Error('Discovery playlist owner changed');
    db().prepare(`INSERT INTO playlist_discovery_releases(id,artist_id,artist,album,release_date,genres_json,evidence_json,identity_verified_at)
      VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET artist_id=excluded.artist_id,artist=excluded.artist,album=excluded.album,release_date=excluded.release_date,
      genres_json=excluded.genres_json,evidence_json=excluded.evidence_json,identity_verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
      .run(release.id,release.artistId,release.artist,release.album,release.releaseDate??null,JSON.stringify(release.genres),JSON.stringify(release.evidence.filter(e=>['musicbrainz','official-release'].includes(e.provider))));
    db().prepare(`INSERT INTO playlist_discovery_recommendations(playlist_id,owner_user_id,release_id,rationale,origin,evidence_json) VALUES(?,?,?,?,?,?)
      ON CONFLICT(playlist_id,release_id) DO UPDATE SET rationale=excluded.rationale,origin=excluded.origin,evidence_json=excluded.evidence_json,updated_at=CURRENT_TIMESTAMP`)
      .run(playlist.id,playlist.ownerUserId,release.id,rationale,origin,JSON.stringify(release.evidence));
  })();
}
export function reserveDiscoveryAdmission(rec:DiscoveryRecommendation,active:number,now=new Date()){
  return db().transaction(()=>{
    const fresh=db().prepare('SELECT d.status,d.cooldown_until,d.evidence_json,p.enabled,p.owner_user_id,r.identity_verified_at FROM playlist_discovery_recommendations d JOIN smart_playlists p ON p.id=d.playlist_id JOIN playlist_discovery_releases r ON r.id=d.release_id WHERE d.id=?').get(rec.id) as {status:string;cooldown_until:string|null;evidence_json:string;enabled:number;owner_user_id:number;identity_verified_at:string|null}|undefined;
    if(!fresh||fresh.owner_user_id!==rec.owner_user_id||!fresh.enabled||!verifiedDiscoveryRecommendation(fresh)||!['researched','deferred'].includes(fresh.status)||fresh.cooldown_until&&Date.parse(fresh.cooldown_until.replace(' ','T')+'Z')>now.getTime())return null;
    const date=now.toISOString().slice(0,10);
    const counts=db().prepare("SELECT count(*) total,sum(playlist_id=?) per_playlist FROM playlist_discovery_admissions WHERE status IN ('reserved','admitted') AND created_at>=?").get(rec.playlist_id,date) as {total:number;per_playlist:number};
    const reservations=(db().prepare("SELECT count(*) n FROM playlist_discovery_admissions WHERE status='reserved'").get() as {n:number}).n;
    if(counts.total>=3||counts.per_playlist>=1||active+reservations>=6)return null;
    const duplicate=db().prepare("SELECT 1 FROM playlist_discovery_admissions WHERE release_id=? AND status='reserved'").get(rec.release_id);
    if(duplicate)return null;
    const id=randomUUID();db().prepare("INSERT INTO playlist_discovery_admissions(id,playlist_id,release_id,created_at) VALUES(?,?,?,?)").run(id,rec.playlist_id,rec.release_id,now.toISOString().slice(0,19).replace('T',' '));return id;
  }).immediate();
}
export function dismissDiscoveryRecommendation(id:number,playlistId:number,ownerId:number){
  return db().prepare("UPDATE playlist_discovery_recommendations SET status='dismissed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND playlist_id=? AND owner_user_id=? AND EXISTS (SELECT 1 FROM smart_playlists p WHERE p.id=playlist_id AND p.owner_user_id=?)").run(id,playlistId,ownerId,ownerId).changes>0;
}
