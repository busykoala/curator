import {db} from '@/features/db/client';
import type {PlaylistDefinition} from './types';
import type {PlaylistIntent} from './intent-schema';
import {discoveryReleaseFit} from './discovery-fit';
import {discoveryRecommendations,verifiedDiscoveryRecommendation,type DiscoveryRecommendation,type DiscoveryRelease} from './discovery-repository';
export const recommendationRelease=(row:DiscoveryRecommendation):DiscoveryRelease=>({id:row.release_id,artistId:row.artist_id,artist:row.artist,album:row.album,releaseDate:row.release_date??undefined,genres:JSON.parse(row.genres_json),evidence:JSON.parse(row.evidence_json),identityVerified:Boolean(row.identity_verified_at)});
export function discoveryResearchDirection(playlist:PlaylistDefinition,intent:PlaylistIntent){return{...playlist,config:{...playlist.config,
  tasteLanes:intent.soft.styles.length?intent.soft.styles:playlist.config.tasteLanes,
  exclusions:[...new Set([...playlist.config.exclusions,...intent.hard.exclusions,...intent.hard.requirements.filter(rule=>['genre','style'].includes(rule.field)&&rule.match==='none').flatMap(rule=>rule.values)])],
}}}
export function revalidateDiscoveryDirection(playlist:PlaylistDefinition,intent:PlaylistIntent){
  const direction=discoveryResearchDirection(playlist,intent);let validated=0;
  for(const row of discoveryRecommendations(playlist.id,playlist.ownerUserId)){
    if(!verifiedDiscoveryRecommendation(row)||!['researched','queued','downloading','ready','deferred'].includes(row.status)||!discoveryReleaseFit(direction,recommendationRelease(row),intent))continue;
    validated+=db().prepare(`UPDATE playlist_discovery_recommendations SET direction_revision=? WHERE id=? AND owner_user_id=?
      AND EXISTS(SELECT 1 FROM smart_playlists p WHERE p.id=playlist_id AND p.owner_user_id=? AND p.revision=?)`).run(playlist.revision??1,row.id,playlist.ownerUserId,playlist.ownerUserId,playlist.revision??1).changes;
  }
  return validated;
}
