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

// These are two independent evidence fields. A model sometimes translates the
// listener's explicit climax exclusion into just one, even with an example.
// Ground both from the real directions; ordinary calm/dynamic preferences do
// not imply this exclusion. Later explicit permission cancels this text guard.
export function groundClimaxExclusion(intent:PlaylistIntent,userDirections:string[]){
  let excluded=false;
  const clauses=/\b(?:(?:no|without|avoid)\s+(?:any\s+)?dramatic\s+climax(?:es)?|(?:allow|include)\s+(?:some\s+)?dramatic\s+climax(?:es)?|dramatic\s+climax(?:es)?\s+(?:are|is)\s+(?:now\s+)?(?:fine|allowed|okay)|(?:keine\s+dramatischen|ohne\s+dramatische)\s+höhepunkte|dramatische\s+höhepunkte\s+sind\s+(?:wieder\s+)?erlaubt)\b/giu;
  for(const direction of userDirections)for(const match of direction.normalize('NFKC').matchAll(clauses))excluded=/^(?:no\b|without\b|avoid\b|keine\b|ohne\b)/i.test(match[0]);
  if(!excluded)return false;
  for(const [field,value] of [['dynamicCharacter','crescendo_build'],['structuralCharacter','build_drop']] as const){
    if(!intent.hard.requirements.some(rule=>rule.field===field&&rule.match==='none'&&rule.values.includes(value)))intent.hard.requirements.push({field,values:[value],match:'none'});
  }
  return true;
}

// “Forgotten favourites” normally means previously enjoyed music. The strict
// native-star filter needs a real exclusive/explicit-star direction, not the
// model's interpretation of that colloquial phrase. Saved hard choices survive.
export function groundFavouritesScope(intent:PlaylistIntent,userDirections:string[],preserved:PlaylistIntent['hard']){
  if(preserved.favouritesOnly)return false;
  const clauses=userDirections.flatMap(direction=>text(direction).split(/[.!?;,]+/));
  let explicit=false;
  for(const clause of clauses){
    const broad=/\b(?:not only|nicht nur|pas seulement)\b.*\b(?:favou?rites?|starred|favoriten)\b|\bplayed\s+or\s+favou?rited\b|\b(?:include|allow)\b.*\b(?:played (?:tracks|songs|music)|listening history|unstarred|unfavou?rited)\b/.test(clause);
    if(broad){explicit=false;continue}
    const exclusive=/\b(?:only|exclusively|strictly|nur|ausschließlich|ausschliesslich|uniquement)\b(?:\s+[\p{L}-]+){0,8}\s+\b(?:favou?rites?|favou?rited|starred|hearted|favoriten)\b/u.test(clause)||/\b(?:favou?rites?|starred)\s+only\b/.test(clause);
    const explicitStar=!/\b(?:prefer|prioriti[sz]e|occasionally)\b/.test(clause)&&/\b(?:my (?:explicitly )?(?:starred|hearted|favou?rited) (?:tracks|songs|music|list|playlist|collection)|(?:tracks|songs|music) (?:that )?i(?: have|['’]ve)? (?:explicitly )?(?:favou?rited|starred|hearted))\b/.test(clause);
    if(exclusive||explicitStar)explicit=true;
  }
  const changed=intent.hard.favouritesOnly!==explicit;intent.hard.favouritesOnly=explicit;return changed;
}
