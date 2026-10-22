import {createHash} from 'node:crypto';
import {db} from '@/features/db/client';
import {identityName as norm} from '@/features/integrations/navidrome-identity';
import {reviewIdentity,reviewIdentityHash} from './metadata-review';
import type {ExternalTrackFact} from './track-evidence';

export type ReviewedTrackSource={url:string;retrievedAt:string;artist:string;title:string;album:string;quote:string;text:string;facts:ExternalTrackFact[]};
// This operation is deliberately absent from AI tools and public routes. A
// source-backed review is bound to the exact local recording identity, not
// merely an artist, album or opened URL. Overrides retain higher precedence.
export function recordReviewedTrackFacts(fileId:number,expectedIdentity:string,source:ReviewedTrackSource,now=Date.now()){
  const row=db().prepare('SELECT id,artist_name,album_name,tags_json,properties_json FROM files WHERE id=?').get(fileId) as (Parameters<typeof reviewIdentity>[0]&{album_name:string})|undefined;
  if(!row||reviewIdentityHash(reviewIdentity(row))!==expectedIdentity)throw Error('Recording identity changed before source review');
  const identity=reviewIdentity(row),quote=norm(source.quote),text=norm(source.text),stamp=Date.parse(source.retrievedAt);
  if(norm(source.artist)!==norm(identity.artist)||norm(source.title)!==norm(identity.title)||norm(source.album)!==norm(row.album_name)||!quote||!text.includes(quote)||!quote.includes(norm(identity.title))||!text.includes(norm(source.album))||!text.includes(norm(source.artist))||!Number.isFinite(stamp)||stamp>now+60_000||now-stamp>7*86400_000)throw Error('Source does not support this recording review');
  const url=new URL(source.url);if(url.protocol!=='https:')throw Error('Reviewed source must use HTTPS');
  if(!source.facts.length||source.facts.some(fact=>fact.scope!=='recording'||fact.url!==source.url))throw Error('Reviewed facts must carry the exact recording-scoped source');
  return db().transaction(()=>{
    const current=db().prepare('SELECT id,artist_name,tags_json,properties_json FROM files WHERE id=?').get(fileId) as Parameters<typeof reviewIdentity>[0]|undefined;
    if(!current||reviewIdentityHash(reviewIdentity(current))!==expectedIdentity)throw Error('Recording identity changed before source review');
    const sourceId='reviewed-track:v1:'+fileId+':'+expectedIdentity+':'+createHash('sha256').update(source.url).digest('hex');
    const payload=JSON.stringify({identityHash:expectedIdentity,artist:source.artist,title:source.title,album:source.album,supportedClaim:source.quote,retrievedAt:source.retrievedAt,facts:source.facts});
    const old=db().prepare('SELECT payload_json,expires_at>CURRENT_TIMESTAMP fresh FROM evidence WHERE provider=? AND source_id=?').get('playlist-track-facts',sourceId) as {payload_json:string;fresh:number}|undefined;
    if(old?.fresh&&JSON.stringify(JSON.parse(old.payload_json).facts)===JSON.stringify(source.facts))return false;
    const day=new Date(now).setUTCHours(0,0,0,0);
    if((db().prepare('SELECT count(*) n FROM playlist_metadata_review_attempts WHERE created_at>=?').get(day) as {n:number}).n>=100)throw Error('Daily track review budget exhausted');
    db().prepare('INSERT INTO playlist_metadata_review_attempts(file_id,created_at) VALUES(?,?)').run(fileId,now);
    db().prepare("INSERT INTO evidence(provider,source_id,entity_key,payload_json,expires_at) VALUES('playlist-track-facts',?,?,?,?) ON CONFLICT(provider,source_id) DO UPDATE SET payload_json=excluded.payload_json,fetched_at=CURRENT_TIMESTAMP,expires_at=excluded.expires_at")
      .run(sourceId,'playlist-track:'+fileId,payload,new Date(stamp+30*86400_000).toISOString().slice(0,19).replace('T',' '));
    db().prepare('DELETE FROM playlist_track_evidence WHERE file_id=?').run(fileId);
    db().prepare('UPDATE playlist_track_embeddings SET updated_at=0 WHERE file_id=?').run(fileId);
    return true;
  }).immediate();
}
export function reviewedTrackFacts(fileId:number,identityHash:string){
  const rows=db().prepare("SELECT payload_json FROM evidence WHERE entity_key=? AND provider='playlist-track-facts' AND expires_at>CURRENT_TIMESTAMP ORDER BY fetched_at DESC").all('playlist-track:'+fileId) as Array<{payload_json:string}>;
  return rows.flatMap(row=>{try{const payload=JSON.parse(row.payload_json);return payload.identityHash===identityHash&&Array.isArray(payload.facts)?payload.facts as ExternalTrackFact[]:[]}catch{return[]}});
}
