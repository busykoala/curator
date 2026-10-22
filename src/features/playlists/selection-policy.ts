import {selectionRecordingKey} from './recording-groups';
import {discoveryDirection} from './discovery-directions';
import {createHash} from 'node:crypto';
import {canonicalSemanticValue,semanticTermVariants} from '@/features/categorization/vocabulary';
import {identityName as norm,trackArtistMatches} from '@/features/integrations/navidrome-identity';
import type {TrackEvidenceView} from './track-evidence';
import type {ListenerSong,ListenerSnapshot} from './listening-snapshot';
import type {PlaylistIntent,SemanticRequirement} from './intent-schema';
import {energyTarget,energyValue} from './sequence';
import type {PlaylistCandidate,PlaylistDefinition} from './types';

export type EvidencedCandidate=PlaylistCandidate&{evidence:TrackEvidenceView;recordingGroupKey?:string;songId:string;listener:ListenerSong|null;exposureCount:number;removedAt:number|null;artistPlayCount?:number;albumLastPlayed?:string|null;discoveryBoost?:number;adjacent?:boolean;adjacencyReason?:string};
export type CandidateAssessment={eligible:boolean;score:number;reasons:string[];violations:string[];uncertainty:string[]};
export type PlaylistEvaluation={eligible:number;selected:number;requested:number;changed:number;retained:number;artistDiversity:number;albumDiversity:number;unheard:number|null;uncertainty:string[];relaxations:string[];shortage:number;violations:string[];diversityLimits?:{artist:number;album:number}};
const values=(v:unknown):string[]=>Array.isArray(v)?v.map(String):v==null?[]:[String(v)];
const days=86400_000;

export function evidenceValues(track:Pick<EvidencedCandidate,'evidence'>,field:string):string[]{
  const fields=field==='genre'?['genre','style']:[field];
  return fields.flatMap(key=>{
    const evidence=track.evidence.fields[key];
    if(!evidence||['unknown','conflict'].includes(evidence.source)||evidence.scope==='artist')return[];
    return values(evidence.value).flatMap(value=>field==='genre'?[canonicalSemanticValue('style',value),canonicalSemanticValue('genre',value)]:[canonicalSemanticValue(field,value)]);
  });
}
// Phrase boundaries prevent rock matching hard rock's antonym-like substrings
// (or an artist named Rockwell). Synonyms use the shared vocabulary.
function matches(term:string,available:string[]){
  return semanticTermVariants(term).some(term=>{const wanted=norm(term);return Boolean(wanted)&&available.some(value=>{
    const actual=norm(value);return actual===wanted||(' '+actual+' ').includes(' '+wanted+' ');
  })});
}
function ruleSatisfied(track:EvidencedCandidate,rule:SemanticRequirement){
  const available=evidenceValues(track,rule.field),found=rule.values.map(term=>matches(term,
    rule.field==='instrumentation'&&norm(term)==='guitar'?available.filter(value=>!/(^| )bass( |$)/.test(norm(value))):available));
  return rule.match==='none'?available.length>0&&!found.some(Boolean):rule.match==='all'?found.every(Boolean):found.some(Boolean);
}

export function assessCandidate(track:EvidencedCandidate,definition:PlaylistDefinition,intent:PlaylistIntent,snapshot:Pick<ListenerSnapshot,'complete'|'stale'>,now=Date.now()):CandidateAssessment{
  const violations:string[]=[],reasons:string[]=[],uncertainty:string[]=[];
  const hard=intent.hard,soft=intent.soft;
  if(intent.excludedFileIds.includes(track.fileId)||intent.excludedRecordings.includes(selectionRecordingKey(track)))violations.push('Current listener exclusion');
  if(intent.trackRequests.some(request=>request.action==='exclude'&&norm(request.title)===norm(track.title)&&(!request.artist||norm(request.artist)===norm(track.artist))))violations.push('Explicitly excluded song');
  for(const requirement of hard.requirements)if(!ruleSatisfied(track,requirement))violations.push(`${requirement.field}: ${requirement.match} ${requirement.values.join(', ')}`);
  const exactArtist=(artist:string)=>trackArtistMatches([track.artist],artist,undefined);
  if(hard.artists.length&&!hard.artists.some(exactArtist))violations.push('Required artist');
  if(hard.excludeArtists.some(exactArtist))violations.push('Excluded artist');
  const semantic=Object.keys(track.evidence.fields).flatMap(field=>evidenceValues(track,field));
  const identity=norm(`${track.artist} ${track.album} ${track.title}`);
  if(hard.exclusions.some(term=>matches(term,[identity,...semantic])))violations.push('Explicit exclusion');
  const vocal=evidenceValues(track,'vocalProfile').map(norm),instrumental=vocal.some(v=>v==='instrumental'||v==='no vocals');
  const hasVoice=vocal.some(v=>!['instrumental','no vocals','unknown','none'].includes(v))||track.evidence.fields.vocalProfile?.source!=='user_override'&&track.evidence.fields.vocalPresence?.value===true;
  if(hard.vocal==='instrumental'&&(!instrumental||hasVoice))violations.push('Instrumental requirement lacks consistent track evidence');
  if(hard.vocal==='vocals'&&!hasVoice)violations.push('Required vocals');
  const versions=evidenceValues(track,'recordingTypes').map(norm),live=versions.some(v=>v==='live'||v==='live recording')||/(?:\(|\[|[-–—]\s*)live(?:\s|[,):\]–—-]|$)/i.test(track.title);
  if(hard.recording==='live'&&!live)violations.push('Required live recording');
  if(hard.recording==='studio'&&(live||!versions.some(v=>v==='studio'||v==='studio recording')))violations.push('Required studio recording is not established');
  const year=track.evidence.originalYear,bpm=Number(track.evidence.fields.bpm?.value??0);
  if(hard.minYear&&(!year||year<hard.minYear)||hard.maxYear&&(!year||year>hard.maxYear))violations.push('Required original recording/release year');
  if(hard.minBpm&&(!bpm||bpm<hard.minBpm)||hard.maxBpm&&(!bpm||bpm>hard.maxBpm))violations.push('Required tempo');
  if((hard.minBpm||hard.maxBpm)&&(!track.evidence.fields.bpm||['low','unknown'].includes(track.evidence.fields.bpm.confidence)||track.evidence.fields.bpm.source==='audio'))violations.push('An inferred or ambiguous tempo cannot establish a strict BPM range');
  if(hard.favouritesOnly&&!track.listener?.favourite)violations.push('Not an observed favourite');
  const listener=track.listener,known=Boolean(listener&&(listener.hasPlayed||listener.playCount>0||listener.favourite));
  const lastPlayed=Date.parse(listener?.lastPlayed??''),age=Number.isFinite(lastPlayed)?Math.max(0,(now-lastPlayed)/days):null;
  if(hard.excludeRecentlyPlayedAlbums){
    const albumPlay=Date.parse(track.albumLastPlayed??'');
    if(!snapshot.complete||snapshot.stale)violations.push('A current complete history is needed to exclude recently played albums');
    else if(Number.isFinite(albumPlay)&&now-albumPlay<definition.config.noveltyDays*days)violations.push('Album played too recently');
  }
  if(definition.category==='rediscovery'){
    if(!known)violations.push('No observed enjoyment or listening history for this recording');
    if(listener?.hasPlayed&&age==null)violations.push('Last-played date is unknown');
    if(age!=null&&age<definition.config.noveltyDays)violations.push('Played too recently');
    if(known&&!violations.length)reasons.push(listener?.favourite?'A saved favourite, not heard recently':`Last heard ${Math.floor(age!)} days ago`);
  }
  const directionValues=evidenceValues(track,'genre');
  const direction=definition.category==='discovery'?discoveryDirection(track,intent):{adjacent:Boolean(track.adjacent),adjacencyReason:track.adjacencyReason};
  const adjacent=direction.adjacent;
  const styleHits=soft.styles.filter(term=>matches(term,directionValues));
  const sceneHits=soft.styles.filter(term=>matches(term,evidenceValues(track,'scenes')));
  const moodHits=soft.moods.filter(term=>matches(term,evidenceValues(track,'mood')));
  const contextHits=soft.contexts.filter(term=>matches(term,evidenceValues(track,'listeningContexts')));
  // Soft styles express the playlist's centre; adjacent candidates must have
  // a validated, explicit relationship, not merely match an unrelated mood.
  if(soft.styles.length&&!styleHits.length&&!adjacent)violations.push('Outside the requested musical direction');
  if(definition.category==='mood'&&(soft.moods.length||soft.contexts.length)&&!moodHits.length&&!contextHits.length)violations.push('No mood or listening-context fit');
  if(styleHits.length)reasons.push(`Style: ${styleHits.slice(0,2).join(', ')}`);
  if(adjacent&&!styleHits.length)reasons.push(direction.adjacencyReason==='local-style-map'?'Adjacent style from Curator’s documented style map':'Adjacent style supported by a discovery-source relationship');
  if(moodHits.length)reasons.push(`Mood: ${moodHits.slice(0,2).join(', ')}`);
  if(contextHits.length)reasons.push(`Context: ${contextHits.slice(0,2).join(', ')}`);
  let score=40+styleHits.length*14+moodHits.length*14+contextHits.length*10+Math.min(2,sceneHits.length)*3;
  if(soft.energy!=='any'){
    const levels=['very_low','low','medium','high','very_high'],current=levels.indexOf(String(track.evidence.fields.energy?.value));
    score+=current<0?-6:12-Math.abs(levels.indexOf(soft.energy)-current)*9;
  }
  if(soft.valence.length&&matches(String(track.evidence.fields.valence?.value??''),soft.valence))score+=8;
  const unheard=snapshot.complete&&!snapshot.stale&&Boolean(listener)&&!known;
  const familiarity=1-definition.config.explorationPercent/100;
  if(definition.category!=='rediscovery')score+=familiarity*((listener?.favourite?12:0)+Math.min(12,Math.log1p(track.artistPlayCount??0)*2));
  if(definition.category==='discovery'){
    score+=unheard?28:known?Math.max(-24,10-Math.log1p(listener?.playCount??0)*10):0;
    if(unheard)reasons.push('Unheard in your complete observed history');
    else if(!snapshot.complete||snapshot.stale||!listener)uncertainty.push('Unheard status is not established');
    if(unheard&&track.artistPlayCount===0)score+=12;
  }
  if(definition.category==='depth')score+=18-Math.min(32,Math.log1p(listener?.playCount??0)*10);
  if(definition.category==='rediscovery')score+=(listener?.favourite?24:0)+Math.min(20,Math.log1p(listener?.playCount??0)*7)+(age==null?0:Math.min(14,age/10));
  score-=Math.min(30,track.exposureCount*5);
  score+=track.discoveryBoost??0;
  for(const field of [...new Set([...hard.requirements.map(r=>r.field),...(hard.vocal!=='any'?['vocalProfile']:[]),...(soft.styles.length?['genre','style']:[]),...(soft.moods.length?['mood']:[]),...(soft.contexts.length?['listeningContexts']:[]),...(soft.energy!=='any'||definition.category==='journey'?['energy']:[])])]){
    if(track.evidence.fields[field]?.source==='model_inference')uncertainty.push(`${field} is model inference`);
    else if(!track.evidence.fields[field]||['unknown','conflict'].includes(track.evidence.fields[field].source))uncertainty.push(`${field} is not established`);
  }
  return{eligible:!violations.length,score,reasons,violations,uncertainty:[...new Set(uncertainty)]};
}

const tie=(seed:string,fileId:number)=>parseInt(createHash('sha256').update(seed+':'+fileId).digest('hex').slice(0,8),16);
export function selectPlaylist(input:{definition:PlaylistDefinition;intent:PlaylistIntent;pool:EvidencedCandidate[];previous:EvidencedCandidate[];snapshot:Pick<ListenerSnapshot,'complete'|'stale'>;now?:number;seed?:string}){
  const {definition,intent}=input,now=input.now??Date.now(),seed=input.seed??new Date(now).toISOString().slice(0,10),target=definition.config.targetTracks;
  if(definition.category==='discovery')input={...input,pool:input.pool.map(track=>({...track,...discoveryDirection(track,intent)}))};
  const assessments=new Map(input.pool.map(track=>[track.fileId,assessCandidate(track,definition,intent,input.snapshot,now)]));
  const priorIds=new Set(input.previous.map(track=>track.fileId)),protectedIds=new Set([...intent.pinnedRecordings.map(pin=>pin.fileId),...intent.positionLocks.map(lock=>lock.fileId)]),canonical=new Map<string,EvidencedCandidate>();
  for(const track of input.pool.filter(track=>assessments.get(track.fileId)!.eligible)){
    const key=selectionRecordingKey(track),existing=canonical.get(key);
    if(!existing||protectedIds.has(track.fileId)&&!protectedIds.has(existing.fileId)||!protectedIds.has(existing.fileId)&&priorIds.has(track.fileId)&&!priorIds.has(existing.fileId))canonical.set(key,track);
  }
  let pool=[...canonical.values()].map(track=>({...track,score:assessments.get(track.fileId)!.score,reason:assessments.get(track.fileId)!.reasons.join(' · ')||'Fits the saved musical direction'}));
  const allEligible=new Set([...assessments].filter(([,assessment])=>assessment.eligible).map(([id])=>id));
  if(intent.hard.singleArtist){
    const groups=new Map<string,typeof pool>(),pinned=new Set([...intent.pinnedRecordings.map(pin=>pin.fileId),...intent.positionLocks.map(lock=>lock.fileId)]);
    for(const track of pool){const key=norm(track.artist);groups.set(key,[...(groups.get(key)??[]),track])}
    const rank=(tracks:typeof pool)=>({pins:tracks.filter(track=>pinned.has(track.fileId)).length,size:Math.min(target,tracks.length),retained:tracks.filter(track=>priorIds.has(track.fileId)).length,fit:tracks.reduce((sum,track)=>sum+track.score,0)/tracks.length});
    pool=[...groups.values()].sort((a,b)=>{const left=rank(a),right=rank(b);return right.pins-left.pins||right.size-left.size||right.retained-left.retained||right.fit-left.fit||norm(a[0].artist).localeCompare(norm(b[0].artist))})[0]??[];
  }
  const priorKeys=new Set(input.previous.map(track=>selectionRecordingKey(track)));
  const prior=pool.filter(track=>priorKeys.has(selectionRecordingKey(track)));
  const byId=new Map(pool.map(track=>[track.fileId,track]));
  const chosen:EvidencedCandidate[]=[],keys=new Set<string>(),artists=new Map<string,number>(),albums=new Map<string,number>(),relaxations:string[]=[];
  const pins=new Set(intent.pinnedRecordings.map(pin=>byId.has(pin.fileId)?selectionRecordingKey(byId.get(pin.fileId)!):pin.recordingKey));
  const lockedIds=new Set(intent.positionLocks.map(lock=>lock.fileId));
  const eligibleNew=pool.filter(track=>!priorKeys.has(selectionRecordingKey(track))&&!(track.removedAt&&now-track.removedAt<14*days));
  let artistLimit=definition.config.maxTracksPerArtist,albumLimit=definition.config.maxTracksPerAlbum;
  pool.sort((a,b)=>b.score-a.score||tie(seed,a.fileId)-tie(seed,b.fileId));
  function add(track:EvidencedCandidate,pinned=false){
    const artist=norm(track.artist),album=artist+'|'+norm(track.album),key=selectionRecordingKey(track);
    if(keys.has(key)||chosen.length>=target)return false;
    if(!pinned&&((artists.get(artist)??0)>=artistLimit||(albums.get(album)??0)>=albumLimit))return false;
    keys.add(key);artists.set(artist,(artists.get(artist)??0)+1);albums.set(album,(albums.get(album)??0)+1);
    chosen.push({...track,retained:priorKeys.has(key)});return true;
  }
  // Pins never bypass eligibility. A new hard exclusion invalidates a pin.
  for(const track of pool)if(pins.has(selectionRecordingKey(track))||lockedIds.has(track.fileId))add(track,true);
  const retainTarget=Math.min(target,Math.max(chosen.filter(t=>t.retained).length,Math.round(target*(1-definition.config.rotationPercent/100))));
  for(const track of [...prior].sort((a,b)=>b.score-a.score)){
    if(chosen.filter(t=>t.retained).length>=retainTarget)break;add(track,true);
  }
  const replacements=target-chosen.length;
  const adjacentTarget=definition.category==='discovery'?Math.round(replacements*.3):0;
  function fill(candidates:EvidencedCandidate[],adjacentLimit=Infinity){
    for(const track of candidates.sort((a,b)=>b.score-a.score||tie(seed,a.fileId)-tie(seed,b.fileId))){
      if(track.adjacent&&chosen.filter(t=>t.adjacent&&!t.retained).length>=adjacentLimit)continue;
      add(track);if(chosen.length>=target)break;
    }
  }
  // Reserve adjacent exploration slots when validated candidates exist.
  if(adjacentTarget)fill(eligibleNew.filter(t=>t.adjacent).slice(0,adjacentTarget),adjacentTarget);
  fill(eligibleNew,adjacentTarget);
  if(chosen.length<target&&eligibleNew.some(t=>t.adjacent)&&definition.category==='discovery'){
    fill(eligibleNew);relaxations.push('Adjacent-style share expanded because familiar-style candidates were insufficient');
  }
  if(chosen.length<target){
    const remaining=eligibleNew.filter(track=>!keys.has(selectionRecordingKey(track)));
    const needed=Math.min(target-chosen.length,remaining.length),grouped=new Map<string,Map<string,number>>();
    for(const track of remaining){const artist=norm(track.artist),album=artist+'|'+norm(track.album),group=grouped.get(artist)??new Map<string,number>();group.set(album,(group.get(album)??0)+1);grouped.set(artist,group)}
    let bestCost=Infinity,best={artist:artistLimit,album:albumLimit};
    // Album groups are nested inside artists, so remaining capacity can be
    // calculated exactly. Relax the preferences only as far as necessary,
    // instead of removing both limits when a narrow style has few artists.
    for(let a=artistLimit;needed&&a<=target;a++){
      const artistCost=(a-artistLimit)/artistLimit;if(artistCost>=bestCost)break;
      for(let b=albumLimit;b<=target;b++){
        const cost=artistCost+(b-albumLimit)/albumLimit;if(cost>=bestCost)break;
        let capacity=0;
        for(const[artist,group]of grouped){let albumCapacity=0;for(const[album,count]of group)albumCapacity+=Math.min(count,Math.max(0,b-(albums.get(album)??0)));capacity+=Math.min(albumCapacity,Math.max(0,a-(artists.get(artist)??0)))}
        if(capacity>=needed){bestCost=cost;best={artist:a,album:b};break}
      }
    }
    artistLimit=best.artist;albumLimit=best.album;
    const before=chosen.length;fill(eligibleNew);
    if(chosen.length>before)relaxations.push('Artist/album variety preferences relaxed to satisfy the musical requirements and requested size');
  }
  // Prefer keeping more suitable current tracks to violating exclusions or
  // recycling a recording removed during the last 14 days.
  if(chosen.length<target){fill(prior);if(chosen.length>=target)relaxations.push('Rotation reduced because too few suitable replacements were available')}
  if(definition.category==='discovery'&&chosen.filter(track=>track.adjacent&&!track.retained).length<adjacentTarget)relaxations.push('Adjacent-style share reduced because too few suitable adjacent recordings were available');
  const ordered:EvidencedCandidate[]=[],remaining=[...chosen],locks=new Map(intent.positionLocks.filter(lock=>byId.has(lock.fileId)&&chosen.some(t=>t.fileId===lock.fileId)).map(lock=>[lock.position,lock.fileId]));
  const curve=intent.energyCurve==='configured'?definition.config.energyCurve:intent.energyCurve,assignedEnergy=new Map<number,number>();
  if(definition.category==='journey'&&curve!=='steady'){
    const reserved=new Set(locks.values()),tracks=chosen.filter(track=>!reserved.has(track.fileId)).sort((a,b)=>energyValue(a)-energyValue(b)||tie(seed,a.fileId)-tie(seed,b.fileId));
    const positions=Array.from({length:chosen.length},(_,position)=>position).filter(position=>!locks.has(position)).sort((a,b)=>energyTarget(curve,a,chosen.length)-energyTarget(curve,b,chosen.length)||a-b);
    // Sorted matching minimises total one-dimensional energy deviation. It
    // reserves low-energy closers for a wave instead of spending them all on
    // its opening. Artist spacing still chooses among equal-energy tracks.
    if(tracks.length===positions.length)positions.forEach((position,index)=>assignedEnergy.set(position,energyValue(tracks[index])));
  }
  for(let position=0;position<chosen.length;position++){
    const lock=locks.get(position);
    const available=remaining.filter(track=>lock?track.fileId===lock:![...locks.values()].includes(track.fileId)&&(!assignedEnergy.has(position)||energyValue(track)===assignedEnergy.get(position)));
    if(!available.length)break;
    const desired=energyTarget(curve,position,chosen.length),previous=ordered.at(-1);
    available.sort((a,b)=>{
      const cost=(t:EvidencedCandidate)=>(previous&&norm(previous.artist)===norm(t.artist)?30:0)+(definition.category==='journey'?Math.abs(energyValue(t)-desired)*35:0)-t.score*.05;
      return cost(a)-cost(b)||tie(seed,a.fileId)-tie(seed,b.fileId);
    });
    const track=available[0];ordered.push(track);remaining.splice(remaining.indexOf(track),1);
  }
  const violations:string[]=[];
  for(const pin of intent.pinnedRecordings)if(allEligible.has(pin.fileId)&&!ordered.some(track=>track.fileId===pin.fileId||selectionRecordingKey(track)===pin.recordingKey))violations.push('A valid pinned recording could not be preserved');
  if(intent.hard.singleArtist&&new Set(ordered.map(track=>norm(track.artist))).size>1)violations.push('Only one artist was requested');
  for(const lock of intent.positionLocks)if(allEligible.has(lock.fileId)&&ordered[lock.position]?.fileId!==lock.fileId)violations.push('A valid position lock could not be preserved');
  const evaluation:PlaylistEvaluation={eligible:pool.length,selected:ordered.length,requested:target,changed:ordered.filter(t=>!t.retained).length,retained:ordered.filter(t=>t.retained).length,
    artistDiversity:new Set(ordered.map(t=>norm(t.artist))).size,albumDiversity:new Set(ordered.map(t=>norm(t.artist)+'|'+norm(t.album))).size,
    unheard:input.snapshot.complete&&!input.snapshot.stale?ordered.filter(t=>t.listener&&!t.listener.hasPlayed&&!t.listener.favourite&&!t.listener.playCount).length:null,
    uncertainty:[...new Set(ordered.flatMap(t=>assessments.get(t.fileId)?.uncertainty??[]))],relaxations,shortage:Math.max(0,target-ordered.length),violations,diversityLimits:{artist:artistLimit,album:albumLimit}};
  return{items:ordered,evaluation};
}
