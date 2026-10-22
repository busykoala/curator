import {identityName as normal} from '@/features/integrations/navidrome-identity';
import type {PlaylistDefinition} from './types';
import type {DiscoveryRelease} from './discovery-repository';
import {canonicalSemanticValue} from '@/features/categorization/vocabulary';
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
  const roots=wanted.map(term=>canonicalSemanticValue('genre',term)),allowed=new Set(roots);
  const neighbours:Record<string,string[]>={electronic:['ambient','experimental_avant_garde'],ambient:['electronic','experimental_avant_garde'],jazz:['rnb_soul_funk','latin','african','electronic'],rock:['pop','punk_hardcore','folk_acoustic'],reggae_dub_ska:['electronic','hip_hop','rnb_soul_funk'],hip_hop:['rnb_soul_funk','electronic','reggae_dub_ska']};
  for(const root of roots)for(const neighbour of neighbours[root]??[])allowed.add(neighbour);
  const releaseRoots=release.genres.map(term=>canonicalSemanticValue('genre',term));
  // A stray broad tag must not turn a predominantly unrelated pop/rock album
  // into an electronic recommendation. Similarity is supporting evidence.
  if(roots.length&&releaseRoots.length&&releaseRoots.filter(root=>allowed.has(root)).length/releaseRoots.length<.5)return null;
  const supported=wanted.filter(term=>styles.some(style=>matches(style,term)));
  const related=release.evidence.find(source=>['listenbrainz','lastfm'].includes(source.provider)&&source.claims.seedArtist&&
    source.claims.seedArtistId&&source.claims.recommendedArtistId===release.artistId&&(!wanted.length||Array.isArray(source.claims.seedStyleTerms)&&
      source.claims.seedStyleTerms.some(term=>wanted.some(wanted=>matches(term,wanted)))));
  if(supported.length)return{lane:'familiar' as const,reason:'Style evidence: '+supported.join(', ')};
  if(related)return{lane:'adjacent' as const,reason:`Similarity recommendation from ${String(related.claims.seedArtist)}; exact release style is not established`};
  return null;
}
