import {canonicalSemanticValue,semanticTermVariants} from '@/features/categorization/vocabulary';
import {identityName as normal} from '@/features/integrations/navidrome-identity';
import type {EvidencedCandidate} from './selection-policy';
import type {PlaylistIntent} from './intent-schema';
// A deliberately small product policy, not a claim of external recommendation
// evidence. Hard requirements/exclusions are still evaluated independently.
const neighbours:Record<string,string[]>={
  melodic_techno:['minimal_techno','dub_techno','deep_house','progressive_house'],
  ambient_techno:['dub_techno','minimal_techno','ambient','microhouse'],
  trip_hop:['dub','downtempo','abstract_hip_hop','nu_jazz'],
  downtempo:['dub','trip_hop','ambient','nu_jazz'],
  deep_house:['dub_techno','microhouse','nu_disco','downtempo'],
  post_rock:['ambient','slowcore','shoegaze'],
  alternative_rock:['post_rock','indie_folk','shoegaze'],
  jazz:['neo_soul','nu_jazz','jazz_funk','afrobeat'],
};
const matches=(term:string,values:string[])=>semanticTermVariants(term).some(alias=>values.some(value=>(' '+normal(value)+' ').includes(' '+normal(alias)+' ')));
export function discoveryDirection(track:EvidencedCandidate,intent:PlaylistIntent){
  const wanted=intent.soft.styles,styles=['genre','style'].flatMap(field=>{
    const evidence=track.evidence.fields[field];if(!evidence||['unknown','conflict'].includes(evidence.source)||evidence.scope==='artist')return[];
    return(Array.isArray(evidence.value)?evidence.value:evidence.value==null?[]:[evidence.value]).map(value=>String(value));
  });
  if(wanted.some(term=>matches(term,styles)))return{adjacent:false,adjacencyReason:''};
  if(track.adjacent&&track.adjacencyReason!=='local-style-map')return{adjacent:true,adjacencyReason:'Verified discovery-source relationship'};
  for(const term of wanted)for(const neighbour of neighbours[canonicalSemanticValue('style',term)]??[])if(matches(neighbour,styles))return{adjacent:true,adjacencyReason:'local-style-map'};
  return{adjacent:false,adjacencyReason:''};
}
