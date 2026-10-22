import {createHash} from 'node:crypto';
import {canonicalSemanticValue} from '@/features/categorization/vocabulary';
import {identityName as norm,trackArtistMatches} from '@/features/integrations/navidrome-identity';
import type {TrackEvidenceView} from './track-evidence';
import type {ListenerSong,ListenerSnapshot} from './listening-snapshot';
import type {PlaylistIntent,SemanticRequirement} from './intent-schema';
import {energyTarget,energyValue} from './sequence';
import type {PlaylistCandidate,PlaylistDefinition} from './types';

export type EvidencedCandidate=PlaylistCandidate&{evidence:TrackEvidenceView;songId:string;listener:ListenerSong|null;exposureCount:number;removedAt:number|null;discoveryBoost?:number;adjacent?:boolean};
export type CandidateAssessment={eligible:boolean;score:number;reasons:string[];violations:string[];uncertainty:string[]};
export type PlaylistEvaluation={eligible:number;selected:number;requested:number;changed:number;retained:number;artistDiversity:number;albumDiversity:number;unheard:number|null;uncertainty:string[];relaxations:string[];shortage:number;violations:string[]};
const values=(v:unknown):string[]=>Array.isArray(v)?v.map(String):v==null?[]:[String(v)];
const days=86400_000;

export function evidenceValues(track:EvidencedCandidate,field:string):string[]{
  const fields=field==='genre'?['genre','style']:[field];
  return fields.flatMap(key=>{
    const evidence=track.evidence.fields[key];
    if(!evidence||['unknown','conflict'].includes(evidence.source)||evidence.scope==='artist')return[];
    return values(evidence.value).map(value=>canonicalSemanticValue(field==='genre'?'style':field,value));
  });
}
// Phrase boundaries prevent rock matching hard rock's antonym-like substrings
// (or an artist named Rockwell). Synonyms use the shared vocabulary.
function matches(term:string,available:string[]){
  const wanted=norm(term);return Boolean(wanted)&&available.some(value=>{
    const actual=norm(value);return actual===wanted||(' '+actual+' ').includes(' '+wanted+' ');
  });
}
function ruleSatisfied(track:EvidencedCandidate,rule:SemanticRequirement){
  const available=evidenceValues(track,rule.field),found=rule.values.map(term=>matches(term,available));
  return rule.match==='none'?available.length>0&&!found.some(Boolean):rule.match==='all'?found.every(Boolean):found.some(Boolean);
}

export function assessCandidate(track:EvidencedCandidate,definition:PlaylistDefinition,intent:PlaylistIntent,snapshot:Pick<ListenerSnapshot,'complete'|'stale'>,now=Date.now()):CandidateAssessment{
  const violations:string[]=[],reasons:string[]=[],uncertainty:string[]=[];
  const hard=intent.hard,soft=intent.soft;
  for(const requirement of hard.requirements)if(!ruleSatisfied(track,requirement))violations.push(`${requirement.field}: ${requirement.match} ${requirement.values.join(', ')}`);
  const exactArtist=(artist:string)=>trackArtistMatches([track.artist],artist,undefined);
  if(hard.artists.length&&!hard.artists.some(exactArtist))violations.push('Required artist');
  if(hard.excludeArtists.some(exactArtist))violations.push('Excluded artist');
  const semantic=Object.keys(track.evidence.fields).flatMap(field=>evidenceValues(track,field));
  const identity=norm(`${track.artist} ${track.album} ${track.title}`);
  if(hard.exclusions.some(term=>matches(term,[identity,...semantic])))violations.push('Explicit exclusion');
  const vocal=evidenceValues(track,'vocalProfile').map(norm),instrumental=vocal.some(v=>v==='instrumental'||v==='no vocals');
  const hasVoice=vocal.some(v=>!['instrumental','no vocals','unknown','none'].includes(v))||track.evidence.fields.vocalPresence?.value===true;
  if(hard.vocal==='instrumental'&&(!instrumental||hasVoice))violations.push('Instrumental requirement lacks consistent track evidence');
  if(hard.vocal==='vocals'&&!hasVoice)violations.push('Required vocals');
  const versions=evidenceValues(track,'recordingTypes').map(norm),live=versions.some(v=>v==='live'||v==='live recording')||/\b(live|concert)\b/.test(norm(track.title));
  if(hard.recording==='live'&&!live)violations.push('Required live recording');
  if(hard.recording==='studio'&&(live||!versions.some(v=>v==='studio'||v==='studio recording')))violations.push('Required studio recording is not established');
  const year=track.evidence.originalYear,bpm=Number(track.evidence.fields.bpm?.value??0);
  if(hard.minYear&&(!year||year<hard.minYear)||hard.maxYear&&(!year||year>hard.maxYear))violations.push('Required original recording/release year');
  if(hard.minBpm&&(!bpm||bpm<hard.minBpm)||hard.maxBpm&&(!bpm||bpm>hard.maxBpm))violations.push('Required tempo');
  if(hard.favouritesOnly&&!track.listener?.favourite)violations.push('Not an observed favourite');
  const listener=track.listener,known=Boolean(listener&&(listener.hasPlayed||listener.playCount>0||listener.favourite));
  const lastPlayed=Date.parse(listener?.lastPlayed??''),age=Number.isFinite(lastPlayed)?Math.max(0,(now-lastPlayed)/days):null;
  if(definition.category==='rediscovery'){
    if(!known)violations.push('No observed enjoyment or listening history for this recording');
    if(listener?.hasPlayed&&age==null)violations.push('Last-played date is unknown');
    if(age!=null&&age<definition.config.noveltyDays)violations.push('Played too recently');
    if(known&&!violations.length)reasons.push(listener?.favourite?'A saved favourite, not heard recently':`Last heard ${Math.floor(age!)} days ago`);
  }
  const styleHits=soft.styles.filter(term=>matches(term,evidenceValues(track,'genre')));
  const moodHits=soft.moods.filter(term=>matches(term,evidenceValues(track,'mood')));
  const contextHits=soft.contexts.filter(term=>matches(term,evidenceValues(track,'listeningContexts')));
  // Soft styles express the playlist's centre; adjacent candidates must have
  // a validated, explicit relationship, not merely match an unrelated mood.
  if(soft.styles.length&&!styleHits.length&&!track.adjacent)violations.push('Outside the requested musical direction');
  if(definition.category==='mood'&&(soft.moods.length||soft.contexts.length)&&!moodHits.length&&!contextHits.length)violations.push('No mood or listening-context fit');
  if(styleHits.length)reasons.push(`Style: ${styleHits.slice(0,2).join(', ')}`);
  if(moodHits.length)reasons.push(`Mood: ${moodHits.slice(0,2).join(', ')}`);
  if(contextHits.length)reasons.push(`Context: ${contextHits.slice(0,2).join(', ')}`);
  let score=40+styleHits.length*14+moodHits.length*14+contextHits.length*10;
  if(soft.energy!=='any'){
    const levels=['very_low','low','medium','high','very_high'],current=levels.indexOf(String(track.evidence.fields.energy?.value));
    score+=current<0?-6:12-Math.abs(levels.indexOf(soft.energy)-current)*9;
  }
  if(soft.valence.length&&matches(String(track.evidence.fields.valence?.value??''),soft.valence))score+=8;
  const unheard=snapshot.complete&&!snapshot.stale&&Boolean(listener)&&!known;
  if(definition.category==='discovery'){
    score+=unheard?28:known?Math.max(-24,10-Math.log1p(listener?.playCount??0)*10):0;
    if(unheard)reasons.push('Unheard in your complete observed history');
    else if(!snapshot.complete||snapshot.stale||!listener)uncertainty.push('Unheard status is not established');
  }
  if(definition.category==='depth')score+=18-Math.min(32,Math.log1p(listener?.playCount??0)*10);
  if(definition.category==='rediscovery')score+=(listener?.favourite?24:0)+Math.min(20,Math.log1p(listener?.playCount??0)*7)+(age==null?0:Math.min(14,age/10));
  score-=Math.min(30,track.exposureCount*5);
  score+=track.discoveryBoost??0;
  for(const field of [...hard.requirements.map(r=>r.field),...(hard.vocal!=='any'?['vocalProfile']:[])]){
    if(track.evidence.fields[field]?.source==='model_inference')uncertainty.push(`${field} is model inference`);
  }
  return{eligible:!violations.length,score,reasons,violations,uncertainty:[...new Set(uncertainty)]};
}

const tie=(seed:string,fileId:number)=>parseInt(createHash('sha256').update(seed+':'+fileId).digest('hex').slice(0,8),16);
export function selectPlaylist(input:{definition:PlaylistDefinition;intent:PlaylistIntent;pool:EvidencedCandidate[];previous:EvidencedCandidate[];snapshot:Pick<ListenerSnapshot,'complete'|'stale'>;now?:number;seed?:string}){
  const {definition,intent}=input,now=input.now??Date.now(),seed=input.seed??new Date(now).toISOString().slice(0,10),target=definition.config.targetTracks;
  const assessments=new Map(input.pool.map(track=>[track.fileId,assessCandidate(track,definition,intent,input.snapshot,now)]));
  const priorIds=new Set(input.previous.map(track=>track.fileId)),canonical=new Map<string,EvidencedCandidate>();
  for(const track of input.pool.filter(track=>assessments.get(track.fileId)!.eligible)){
    const key=track.evidence.recordingKey,existing=canonical.get(key);
    if(!existing||priorIds.has(track.fileId)&&!priorIds.has(existing.fileId))canonical.set(key,track);
  }
  const pool=[...canonical.values()].map(track=>({...track,score:assessments.get(track.fileId)!.score,reason:assessments.get(track.fileId)!.reasons.join(' · ')||'Fits the saved musical direction'}));
  const priorKeys=new Set(input.previous.map(track=>track.evidence.recordingKey));
  const prior=pool.filter(track=>priorKeys.has(track.evidence.recordingKey));
  const byId=new Map(pool.map(track=>[track.fileId,track]));
  const chosen:EvidencedCandidate[]=[],keys=new Set<string>(),artists=new Map<string,number>(),albums=new Map<string,number>(),relaxations:string[]=[];
  const pins=new Set(intent.pinnedRecordings.map(pin=>pin.recordingKey));
  const lockedIds=new Set(intent.positionLocks.map(lock=>lock.fileId));
  const eligibleNew=pool.filter(track=>!priorKeys.has(track.evidence.recordingKey)&&!(track.removedAt&&now-track.removedAt<14*days));
  pool.sort((a,b)=>b.score-a.score||tie(seed,a.fileId)-tie(seed,b.fileId));
  function add(track:EvidencedCandidate,pinned=false,relaxDiversity=false){
    const artist=norm(track.artist),album=artist+'|'+norm(track.album),key=track.evidence.recordingKey;
    if(keys.has(key)||chosen.length>=target)return false;
    if(!pinned&&!relaxDiversity&&((artists.get(artist)??0)>=definition.config.maxTracksPerArtist||(albums.get(album)??0)>=definition.config.maxTracksPerAlbum))return false;
    keys.add(key);artists.set(artist,(artists.get(artist)??0)+1);albums.set(album,(albums.get(album)??0)+1);
    chosen.push({...track,retained:priorKeys.has(key)});return true;
  }
  // Pins never bypass eligibility. A new hard exclusion invalidates a pin.
  for(const track of pool)if(pins.has(track.evidence.recordingKey)||lockedIds.has(track.fileId))add(track,true);
  const retainTarget=Math.min(target,Math.max(chosen.filter(t=>t.retained).length,Math.round(target*(1-definition.config.rotationPercent/100))));
  for(const track of [...prior].sort((a,b)=>b.score-a.score)){
    if(chosen.filter(t=>t.retained).length>=retainTarget)break;add(track);
  }
  const replacements=target-chosen.length;
  const adjacentTarget=definition.category==='discovery'?Math.round(replacements*.3):0;
  function fill(candidates:EvidencedCandidate[],adjacentLimit=Infinity,relaxDiversity=false){
    for(const track of candidates.sort((a,b)=>b.score-a.score||tie(seed,a.fileId)-tie(seed,b.fileId))){
      if(track.adjacent&&chosen.filter(t=>t.adjacent&&!t.retained).length>=adjacentLimit)continue;
      add(track,false,relaxDiversity);if(chosen.length>=target)break;
    }
  }
  // Reserve adjacent exploration slots when validated candidates exist.
  if(adjacentTarget)fill(eligibleNew.filter(t=>t.adjacent).slice(0,adjacentTarget),adjacentTarget);
  fill(eligibleNew,adjacentTarget);
  if(chosen.length<target&&eligibleNew.some(t=>t.adjacent)&&definition.category==='discovery'){
    fill(eligibleNew);relaxations.push('Adjacent-style share expanded because familiar-style candidates were insufficient');
  }
  if(chosen.length<target){
    const before=chosen.length;fill(eligibleNew,Infinity,true);
    if(chosen.length>before)relaxations.push('Artist/album variety preferences relaxed to satisfy the musical requirements and requested size');
  }
  // Prefer keeping more suitable current tracks to violating exclusions or
  // recycling a recording removed during the last 14 days.
  if(chosen.length<target){fill(prior);if(chosen.length>=target)relaxations.push('Rotation reduced because too few suitable replacements were available')}
  const ordered:EvidencedCandidate[]=[],remaining=[...chosen],locks=new Map(intent.positionLocks.filter(lock=>byId.has(lock.fileId)&&chosen.some(t=>t.fileId===lock.fileId)).map(lock=>[lock.position,lock.fileId]));
  for(let position=0;position<chosen.length;position++){
    const lock=locks.get(position);
    const available=remaining.filter(track=>lock?track.fileId===lock:![...locks.values()].includes(track.fileId));
    if(!available.length)break;
    const desired=energyTarget(definition.config.energyCurve,position,chosen.length),previous=ordered.at(-1);
    available.sort((a,b)=>{
      const cost=(t:EvidencedCandidate)=>(previous&&norm(previous.artist)===norm(t.artist)?30:0)+(definition.category==='journey'?Math.abs(energyValue(t)-desired)*35:0)-t.score*.05;
      return cost(a)-cost(b)||tie(seed,a.fileId)-tie(seed,b.fileId);
    });
    const track=available[0];ordered.push(track);remaining.splice(remaining.indexOf(track),1);
  }
  const violations:string[]=[];
  for(const lock of intent.positionLocks)if(byId.has(lock.fileId)&&ordered[lock.position]?.fileId!==lock.fileId)violations.push('A valid position lock could not be preserved');
  const evaluation:PlaylistEvaluation={eligible:pool.length,selected:ordered.length,requested:target,changed:ordered.filter(t=>!t.retained).length,retained:ordered.filter(t=>t.retained).length,
    artistDiversity:new Set(ordered.map(t=>norm(t.artist))).size,albumDiversity:new Set(ordered.map(t=>norm(t.artist)+'|'+norm(t.album))).size,
    unheard:input.snapshot.complete&&!input.snapshot.stale?ordered.filter(t=>t.listener&&!t.listener.hasPlayed&&!t.listener.favourite&&!t.listener.playCount).length:null,
    uncertainty:[...new Set(ordered.flatMap(t=>assessments.get(t.fileId)?.uncertainty??[]))],relaxations,shortage:Math.max(0,target-ordered.length),violations};
  return{items:ordered,evaluation};
}
