import {canonicalSemanticValue} from '@/features/categorization/vocabulary';
import type {PlaylistIntent,SemanticRequirement} from './intent-schema';
export type PreferenceProof={field:'mood'|'listeningContexts';quote:string};
const text=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const mandatory=/\b(must|required|mandatory|strictly|only|every song|every track|all songs|all tracks|nur|muss|müssen|ausschließlich|ausschliesslich)\b/i;
function supports(field:string,value:string,quote:string){
  const canonical=canonicalSemanticValue(field,value);
  const words=quote.toLowerCase().match(/[\p{L}\p{N}_-]+/gu)??[];
  for(let start=0;start<words.length;start++)for(let length=1;length<=3;length++)if(canonicalSemanticValue(field,words.slice(start,start+length).join(' '))===canonical)return true;
  return false;
}
export function enforceSoftPreferences(intent:PlaylistIntent,proofs:PreferenceProof[],userDirections:string[],preserved:SemanticRequirement[]=[]){
  const source=userDirections.map(text),demoted:Array<{field:string;values:string[]}>=[];
  const protectedRules=new Set(preserved.map(rule=>JSON.stringify(rule)));
  intent.hard.requirements=intent.hard.requirements.flatMap(rule=>{
    if(!['mood','listeningContexts'].includes(rule.field)||rule.match==='none'||protectedRules.has(JSON.stringify(rule)))return[rule];
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

// Discovery's default style centre allows documented adjacent exploration. A
// generated all-song style restriction needs an actual exclusive user clause;
// configured and already-saved hard requirements remain immutable.
export function enforceDiscoveryStylePreferences(intent:PlaylistIntent,userDirections:string[],preserved:SemanticRequirement[]){
  const protectedRules=new Set(preserved.map(rule=>JSON.stringify(rule)));
  const exclusive=/\b(only|nothing but|strictly|exclusively|every song|every track|all songs|all tracks|must be|has to be|required|mandatory|nur|ausschließlich|ausschliesslich|pflicht|uniquement|seulement)\b/i;
  const clauses=userDirections.flatMap(direction=>direction.split(/[.!?;]+/)).filter(clause=>!/\b(not only|nicht nur|pas seulement)\b/i.test(clause));
  const demoted:Array<{field:string;values:string[]}>=[];
  intent.hard.requirements=intent.hard.requirements.flatMap(rule=>{
    if(!['genre','style'].includes(rule.field)||rule.match==='none'||protectedRules.has(JSON.stringify(rule)))return[rule];
    const justified=rule.values.filter(value=>clauses.some(clause=>exclusive.test(clause)&&supports('style',value,clause)));
    const soft=rule.values.filter(value=>!justified.includes(value));
    if(soft.length){intent.soft.styles=[...new Set([...intent.soft.styles,...soft])];demoted.push({field:rule.field,values:soft})}
    return justified.length?[{...rule,values:justified}]:[];
  });
  return demoted;
}

// Keep the listener's qualified festival exclusion precise. A bare model
// token "edm" both over-excludes compatible music and misses known big-room
// aliases. An explicit general EDM ban in configuration or directions wins.
export function groundFestivalExclusion(intent:PlaylistIntent,userDirections:string[],preserved:PlaylistIntent['hard']){
  const normal=(value:string)=>text(value).replace(/[_-]+/g,' ');
  if(preserved.exclusions.some(value=>normal(value)==='edm')||preserved.requirements.some(rule=>rule.match==='none'&&rule.values.some(value=>normal(value)==='edm')))return false;
  const directions=userDirections.map(normal),qualified=/\bfestival\s+edm\b/g;
  if(!preserved.exclusions.some(value=>normal(value)==='festival edm')&&!directions.some(direction=>/\bfestival\s+edm\b/.test(direction)))return false;
  if(directions.some(direction=>/\bedm\b/.test(direction.replace(qualified,''))))return false;
  let changed=false;
  const grounded=(value:string)=>{if(normal(value)!=='edm')return value;changed=true;return'festival_edm'};
  intent.hard.exclusions=[...new Set(intent.hard.exclusions.map(grounded))];
  intent.hard.requirements=intent.hard.requirements.map(rule=>['genre','style'].includes(rule.field)&&rule.match==='none'?{...rule,values:[...new Set(rule.values.map(grounded))]}:rule);
  return changed;
}
