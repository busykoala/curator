import {identityName as normal} from '@/features/integrations/navidrome-identity';
import type {PlaylistDefinition} from './types';
import type {DiscoveryRelease} from './discovery-repository';
const matches=(text:string,term:string)=>Boolean(normal(term))&&(' '+normal(text)+' ').includes(' '+normal(term)+' ');
export function discoveryReleaseFit(playlist:PlaylistDefinition,release:DiscoveryRelease){
  const wanted=playlist.config.tasteLanes.length?playlist.config.tasteLanes:playlist.config.genres;
  const styles=[...release.genres];
  for(const source of release.evidence){
    const quote=String(source.claims.styleQuote??source.claims.supportingQuote??'');
    const terms=source.claims.supportedStyleTerms;
    if(Array.isArray(terms))styles.push(...terms.filter(term=>matches(quote,term)));
  }
  if(playlist.config.exclusions.some(term=>styles.some(style=>matches(style,term))))return null;
  const supported=wanted.filter(term=>styles.some(style=>matches(style,term)));
  const related=release.evidence.find(source=>['listenbrainz','lastfm'].includes(source.provider)&&source.claims.seedArtist&&
    source.claims.seedArtistId&&source.claims.recommendedArtistId===release.artistId);
  if(supported.length)return{lane:'familiar' as const,reason:'Style evidence: '+supported.join(', ')};
  if(related)return{lane:'adjacent' as const,reason:`Similarity recommendation from ${String(related.claims.seedArtist)}; exact release style is not established`};
  return null;
}
