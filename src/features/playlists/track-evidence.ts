import {createHash} from 'node:crypto';
import {canonicalSemanticField,canonicalSemanticValue} from '@/features/categorization/vocabulary';
import {norm} from './candidate-score';
import {semanticListFields} from '@/features/categorization/types';

export type EvidenceConfidence='high'|'medium'|'low'|'unknown';
export type FieldEvidence={value:unknown;source:'user_override'|'embedded'|'external'|'audio'|'model_inference'|'unknown'|'conflict';scope:'recording'|'release'|'artist';confidence:EvidenceConfidence;references:string[];note?:string};
export type ExternalTrackFact={field:string;value:unknown;scope:FieldEvidence['scope'];url:string;recordingId?:string};
export type TrackEvidenceView={version:1;fields:Record<string,FieldEvidence>;recordingKey:string;originalYear:number|null;editionYear:number|null;conflicts:string[]};
type Input={artist:string;title:string;profile:Record<string,unknown>;tags:Record<string,unknown>;manual?:Record<string,unknown>;provenance?:Record<string,unknown>;audio?:Record<string,unknown>;external?:ExternalTrackFact[]};
const values=(v:unknown):string[]=>Array.isArray(v)?v.map(String):v==null||v===''?[]:[String(v)];
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const comparable=(field:string,value:unknown)=>JSON.stringify(values(value).map(v=>canonicalSemanticValue(field,v)).sort());
const year=(v:unknown)=>{const n=Number(values(v)[0]?.slice(0,4));return n>=1000&&n<=2100?n:null};
export function buildTrackEvidence(input:Input):TrackEvidenceView{
  const tags=Object.fromEntries(Object.entries(input.tags).map(([k,v])=>[canonicalSemanticField(k),v]));
  const profile=Object.fromEntries(Object.entries(input.profile).map(([k,v])=>[canonicalSemanticField(k),v]));
  const manual=Object.fromEntries(Object.entries(input.manual??{}).map(([k,v])=>[canonicalSemanticField(k),v]));
  const fields:Record<string,FieldEvidence>={},conflicts:string[]=[];
  const semanticFields=new Set<string>([...semanticListFields,'bpm','energy','valence','musicalKey','mode','tempoFeel','danceability','acousticElectronicCharacter']);
  for(const field of new Set([...Object.keys(profile),...Object.keys(manual),...Object.keys(tags).filter(k=>semanticFields.has(k))])){
    const inferred=profile[field];
    if(Object.hasOwn(manual,field)){fields[field]={value:manual[field],source:'user_override',scope:'recording',confidence:'high',references:[]};continue}
    const facts=(input.external??[]).filter(f=>canonicalSemanticField(f.field)===field&&f.scope==='recording');
    const embedded=tags[field];
    const generated=Boolean(input.provenance?.model)&&comparable(field,embedded)===comparable(field,inferred);
    if(facts[0]&&embedded!=null&&!generated&&comparable(field,embedded)!==comparable(field,facts[0].value)){
      fields[field]={value:null,source:'conflict',scope:'recording',confidence:'unknown',references:facts.map(f=>f.url),note:'Embedded and external recording facts disagree'};conflicts.push(field);continue;
    }
    if(facts.length&&new Set(facts.map(f=>comparable(field,f.value))).size>1){fields[field]={value:null,source:'conflict',scope:'recording',confidence:'unknown',references:facts.map(f=>f.url),note:'Independent recording facts disagree'};conflicts.push(field);continue}
    if(facts[0]){fields[field]={value:facts[0].value,source:'external',scope:'recording',confidence:'high',references:facts.map(f=>f.url)};continue}
    // Curator writes its semantic profile back into tags. A matching tag is
    // not an independent second source for the model's own inference.
    if(embedded!=null&&!generated){fields[field]={value:embedded,source:'embedded',scope:'recording',confidence:'medium',references:[]};continue}
    fields[field]={value:inferred??null,source:inferred==null?'unknown':'model_inference',scope:'recording',confidence:inferred==null?'unknown':'low',references:[],note:generated?'Semantic tag mirrors the generated profile; independent support is not established':undefined};
  }
  const vocal=values(fields.vocalProfile?.value).map(v=>canonicalSemanticValue('vocalProfile',v));
  if(vocal.includes('instrumental')&&vocal.some(v=>/^(spoken|rap|clean_sung|sung|chant|choir)$/.test(v))&&fields.vocalProfile.source!=='user_override'){
    fields.vocalProfile={...fields.vocalProfile,value:null,source:'conflict',confidence:'unknown',note:'Instrumental and vocal/spoken claims conflict'};conflicts.push('vocalProfile');
  }
  const estimated=Number(input.audio?.estimatedBpm),regularity=Number(input.audio?.beatRegularity??0);
  if(!fields.bpm?.value&&estimated>0&&regularity>=.6){fields.bpm={value:estimated,source:'audio',scope:'recording',confidence:'medium',references:[],note:'Tempo estimate; half/double-time ambiguity remains possible'}}
  // No instrumental/vocal detector exists in the current numeric analyzer.
  // Semantic energy also remains an inference, never a loudness measurement.
  const tag=(...names:string[])=>Object.entries(input.tags).filter(([k])=>names.includes(k.toLowerCase().replace(/[^a-z]/g,''))).flatMap(([,v])=>values(v));
  const embeddedRecordingId=tag('musicbrainzrecordingid','musicbrainztrackid').find(v=>uuid.test(v));
  const verifiedRecording=(input.external??[]).find(f=>f.field==='recordingId'&&f.scope==='recording'&&uuid.test(String(f.value)));
  const recordingId=verifiedRecording?String(verifiedRecording.value):undefined;
  if(recordingId||embeddedRecordingId)fields.recordingId={value:recordingId??embeddedRecordingId,source:verifiedRecording?'external':'embedded',scope:'recording',confidence:verifiedRecording?'high':'medium',references:verifiedRecording?[verifiedRecording.url]:[],note:verifiedRecording?undefined:'ID syntax is valid; recording identity has not been independently verified'};
  const version=values(fields.recordingTypes?.value).map(v=>canonicalSemanticValue('recordingTypes',v)).filter(v=>/live|remix|acoustic|alternate/.test(v)).sort().join('|');
  const recordingKey=recordingId?`mb:${recordingId.toLowerCase()}`:`text:${norm(input.artist)}|${norm(input.title)}|${version||'unspecified'}`;
  const original=(input.external??[]).find(f=>['originalDate','originalYear'].includes(f.field)&&f.scope!=='artist');
  const originalYear=year(original?.value??tag('originaldate','originalyear')[0]);
  const editionYear=year(input.tags.date??input.tags.year);
  fields.originalYear={value:originalYear,source:original?'external':originalYear?'embedded':'unknown',scope:original?.scope??'recording',confidence:originalYear?'medium':'unknown',references:original?[original.url]:[]};
  fields.editionYear={value:editionYear,source:editionYear?'embedded':'unknown',scope:'release',confidence:editionYear?'medium':'unknown',references:[],note:'Edition year does not establish the original recording year'};
  return{version:1,fields,recordingKey,originalYear,editionYear,conflicts:[...new Set(conflicts)]};
}
export function trackEvidenceHash(input:Input){return createHash('sha256').update(JSON.stringify(input)).digest('hex')}
