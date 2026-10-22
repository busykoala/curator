import {db} from '@/features/db/client';
import {playlistTrackEvidence} from './evidence-repository';
export type SongExplanation={fields:Array<{name:string;value:string;source:string;confidence:string;scope:string}>;references:Array<{url:string;scope:string}>;uncertainty:string[]};
export function songExplanation(fileId:number,playlistId:number,ownerId:number):SongExplanation|null{
  const evidence=playlistTrackEvidence(fileId);if(!evidence)return null;
  const fields=['genre','style','mood','listeningContexts','vocalProfile','instrumentation','energy'];
  const explanation:SongExplanation={fields:[],references:[],uncertainty:[]};
  for(const name of fields){
    const field=evidence.fields[name];if(!field)continue;
    if(field.source==='conflict'){explanation.uncertainty.push(`${name}: conflicting evidence`);continue}
    if(field.value==null)continue;
    explanation.fields.push({name,value:Array.isArray(field.value)?field.value.join(', '):String(field.value),source:field.source,confidence:field.confidence,scope:field.scope});
    explanation.references.push(...field.references.map(url=>({url,scope:field.scope})));
  }
  const release=db().prepare(`SELECT r.evidence_json FROM playlist_discovery_recommendations d JOIN playlist_discovery_releases r ON r.id=d.release_id
    JOIN smart_playlists p ON p.id=d.playlist_id AND p.owner_user_id=d.owner_user_id
    JOIN files f ON f.id=? LEFT JOIN manual_overrides m ON m.album_key=f.album_key AND m.confirmed=1
    WHERE d.playlist_id=? AND d.owner_user_id=? AND (m.release_group_mbid=r.id OR EXISTS(SELECT 1 FROM json_each(f.tags_json) tag
      WHERE lower(replace(tag.key,'_',''))='musicbrainzreleasegroupid' AND (tag.value=r.id OR EXISTS(SELECT 1 FROM json_each(CASE WHEN tag.type='array' THEN tag.value ELSE '[]' END) WHERE value=r.id))))`)
    .all(fileId,playlistId,ownerId) as Array<{evidence_json:string}>;
  for(const row of release)for(const source of JSON.parse(row.evidence_json) as Array<{url:string;scope:string}>)explanation.references.push({url:source.url,scope:source.scope});
  const urls=new Set<string>();
  explanation.references=explanation.references.filter(source=>{try{const url=new URL(source.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||urls.has(source.url))return false;urls.add(source.url);return true}catch{return false}});
  return explanation;
}
