import {canonicalSemanticValue} from '@/features/categorization/vocabulary';
import type {PlaylistIntent} from './intent-schema';
export type PreferenceProof={field:'mood'|'listeningContexts';quote:string};
const text=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const mandatory=/\b(must|required|mandatory|strictly|only|every song|every track|all songs|all tracks|nur|muss|müssen|ausschließlich|ausschliesslich)\b/i;
function supports(field:string,value:string,quote:string){
  const canonical=canonicalSemanticValue(field,value);
  const words=quote.toLowerCase().match(/[\p{L}\p{N}_-]+/gu)??[];
  for(let start=0;start<words.length;start++)for(let length=1;length<=3;length++)if(canonicalSemanticValue(field,words.slice(start,start+length).join(' '))===canonical)return true;
  return false;
}
export function enforceSoftPreferences(intent:PlaylistIntent,proofs:PreferenceProof[],userDirections:string[]){
  const source=userDirections.map(text),demoted:Array<{field:string;values:string[]}>=[];
  intent.hard.requirements=intent.hard.requirements.flatMap(rule=>{
    if(!['mood','listeningContexts'].includes(rule.field)||rule.match==='none')return[rule];
    const justified=rule.values.filter(value=>proofs.some(proof=>proof.field===rule.field&&source.some(direction=>direction.includes(text(proof.quote)))&&
      proof.quote.split(/[.!?;]+/).some(clause=>mandatory.test(clause)&&supports(rule.field,value,clause))));
    const soft=rule.values.filter(value=>!justified.includes(value));
    if(soft.length){
      const key=rule.field==='mood'?'moods':'contexts';intent.soft[key]=[...new Set([...intent.soft[key],...soft])];demoted.push({field:rule.field,values:soft});
    }
    return justified.length?[{...rule,values:justified}]:[];
  });
  return demoted;
}
