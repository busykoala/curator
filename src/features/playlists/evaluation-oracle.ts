import type {EvidencedCandidate} from './selection-policy';
import type {ListenerSnapshot} from './listening-snapshot';

// Independent, fixed expectations derived from evaluation-cases.ts. Do not use
// the generated intent or production scoring to decide whether a run passed.
const normal=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[-_/]+/g,' ').replace(/\s+/g,' ').trim();
const field=(track:EvidencedCandidate,key:string)=>{
  const evidence=track.evidence.fields[key];if(!evidence||['unknown','conflict'].includes(evidence.source))return[];
  return(Array.isArray(evidence.value)?evidence.value:evidence.value==null?[]:[evidence.value]).map(value=>normal(String(value)));
};
const matches=(values:string[],term:string)=>values.some(value=>(' '+value+' ').includes(' '+term+' '));
export function scenarioViolations(id:string,items:EvidencedCandidate[],options:{stage?:'initial'|'correction'|'nightly';previous?:EvidencedCandidate[];snapshot?:ListenerSnapshot;now?:number;available?:EvidencedCandidate[];checkOrdering?:boolean}={}){
  const violations=new Set<string>(),corrected=options.stage==='correction'||options.stage==='nightly',now=options.now??Date.now();
  for(const track of items){
    const genres=[...field(track,'genre'),...field(track,'style')],has=(term:string)=>matches(genres,term);
    // Independent reference family, intentionally not the application's genre
    // mapper. A hip-hop/pop/ambient primary tag can coexist with an explicitly
    // electronic style; ambient or amplified instruments alone do not prove it.
    const electronic=has('electronic')||['trip hop','downtempo','synthpop','synth pop','electronica','techno','house','idm','breakbeat','drum and bass','dubstep','electro'].some(has);
    // Exact style names are independent Jazz-family evidence. Compound
    // electronic/R&B swing styles and a swung groove alone are insufficient.
    const jazzStyle=has('jazz')||genres.some(value=>['swing','bebop','hard bop','post bop','post bebop'].includes(value));
    const vocal=field(track,'vocalProfile'),instrumental=vocal.length>0&&vocal.every(value=>value==='instrumental'||value==='no vocals')&&(track.evidence.fields.vocalProfile?.source==='user_override'||track.evidence.fields.vocalPresence?.value!==true);
    const live=field(track,'recordingTypes').some(value=>matches([value],'live'))||/(?:\(|\[|[-–—]\s*)live(?:\s|[,):\]–—-]|$)/i.test(track.title);
    const jazz=['discovery-jazz','depth-piano','mood-jazz','journey-descent','rediscovery-favourites','chat-hard-correction'].includes(id);
    if(jazz&&!jazzStyle&&!(id==='discovery-jazz'&&['neo soul','nu jazz','jazz funk','afrobeat'].some(has)))violations.add('Expected jazz direction or an agreed Discovery neighbour');
    if(['depth-rock','depth-versions','journey-ascent','journey-steady','chat-artist-decade'].includes(id)&&!has('rock')&&!(id==='chat-artist-decade'&&has('punk')))violations.add('Expected rock/punk direction');
    if(id==='discovery-techno'&&!['melodic techno','ambient techno','minimal techno','dub techno','deep house','progressive house','ambient','microhouse'].some(has))violations.add('Expected requested techno centre or an agreed neighbouring style');
    if(['depth-downtempo'].includes(id)&&!has('downtempo'))violations.add('Electronic alone is not downtempo');
    if(['mood-late-night','chat-keep-order'].includes(id)&&!has('trip hop'))violations.add('Expected trip-hop direction');
    if(id==='discovery-unicode'&&!jazzStyle&&!electronic)violations.add('Expected jazz or electronic direction');
    if(id==='discovery-unicode'&&live)violations.add('Excluded live version');
    if(id==='depth-versions'&&!live)violations.add('Required live performance');
    if(['journey-wave','rediscovery-genre'].includes(id)&&!electronic)violations.add('Expected electronic direction');
    const piano=id==='depth-piano'||id==='chat-hard-correction'&&corrected;
    const noVocals=['depth-piano','mood-focus','journey-descent'].includes(id)||['chat-hard-correction','chat-german'].includes(id)&&corrected;
    if(noVocals&&!instrumental)violations.add('Required consistent instrumental evidence');
    if(piano&&!matches(field(track,'instrumentation'),'piano'))violations.add('Required piano evidence');
    if(id==='chat-hard-correction'&&corrected&&has('electronic'))violations.add('Excluded electronic music');
    if(id==='journey-ascent'&&!field(track,'instrumentation').some(value=>matches([value],'guitar')&&!matches([value],'bass')))violations.add('Required guitar beyond bass alone');
    if(['journey-ascent','chat-artist-decade','chat-german'].includes(id)&&has('metal'))violations.add('Excluded metal');
    if(id==='chat-keep-order'&&has('rock'))violations.add('Excluded rock');
    if(['discovery-techno','mood-late-night','journey-wave'].includes(id)&&(has('festival edm')||has('big room house')||has('festival progressive house')))violations.add('Excluded festival EDM');
    if(id==='mood-late-night'&&has('punk'))violations.add('Excluded punk');
    if(id==='mood-focus'&&[...field(track,'dynamicCharacter'),...field(track,'structuralCharacter')].some(value=>['crescendo build','build drop','dramatic climax'].includes(value)))violations.add('Excluded dramatic climax');
    if(id==='mood-morning'&&[...field(track,'mood'),...field(track,'timbre')].some(value=>['aggressive','harsh'].includes(value)))violations.add('Excluded aggressive/harsh track');
    if(id==='mood-jazz'&&has('free jazz')&&['high','very high'].includes(field(track,'energy')[0]))violations.add('Excluded hectic free jazz');
    if(id==='journey-steady'&&['very low','low'].includes(field(track,'energy')[0]))violations.add('Excluded sleepy interlude');
    if(id==='chat-german'&&live&&['high','very high'].includes(field(track,'energy')[0]))violations.add('Excluded loud live performance');
    if(id==='chat-artist-decade'){
      if(!track.evidence.originalYear||track.evidence.originalYear<1990||track.evidence.originalYear>1999)violations.add('Required original 1990s date');
      if(corrected&&normal(track.artist)!=='green day')violations.add('Required exact Green Day artist');
    }
    if(id.startsWith('rediscovery-')){
      const song=track.listener;
      if(!song||!song.hasPlayed&&!song.playCount&&!song.favourite)violations.add('Rediscovery without observed enjoyment');
      if(song?.hasPlayed&&(!song.lastPlayed||now-Date.parse(song.lastPlayed)<30*86400_000))violations.add('Required 30-day listening gap');
      if(id==='rediscovery-small'&&!song?.favourite)violations.add('Required exact-song favourite');
      if(id==='rediscovery-genre'&&options.snapshot?.songs.some(song=>normal(song.artist)===normal(track.listener?.artist??track.artist)&&normal(song.album)===normal(track.album)&&song.lastPlayed&&now-Date.parse(song.lastPlayed)<30*86400_000))violations.add('Album played recently');
    }
  }
  if(id==='rediscovery-small'&&new Set(items.map(track=>normal(track.artist))).size>1)violations.add('Only one artist requested');
  if(options.checkOrdering!==false&&corrected&&id==='chat-artist-decade'&&options.available?.some(track=>normal(track.artist)==='green day'&&normal(track.title)==='basket case'&&track.evidence.originalYear&&track.evidence.originalYear>=1990&&track.evidence.originalYear<=1999)){
    if(normal(items[0]?.artist??'')!=='green day'||normal(items[0]?.title??'')!=='basket case')violations.add('Requested Basket Case opener was available but not first');
  }
  if(options.checkOrdering!==false&&corrected&&['chat-keep-order','chat-german'].includes(id))for(const[index,prior]of(options.previous??[]).slice(0,2).entries()){
    if(id==='chat-german'&&(!field(prior,'vocalProfile').length||field(prior,'vocalProfile').some(value=>value!=='instrumental')))continue;
    if(items[index]?.evidence.recordingKey!==prior.evidence.recordingKey)violations.add('Requested first-two position lock lost');
  }
  return[...violations];
}
export function independentEligibleCount(id:string,pool:EvidencedCandidate[],options:Parameters<typeof scenarioViolations>[2]={}){
  const eligible=pool.filter(track=>!scenarioViolations(id,[track],{...options,previous:[],checkOrdering:false}).length);
  const identity=(track:EvidencedCandidate)=>track.recordingGroupKey??track.evidence.recordingKey;
  if(id==='rediscovery-small'){
    const artists=new Map<string,Set<string>>();for(const track of eligible){const key=normal(track.artist),recordings=artists.get(key)??new Set<string>();recordings.add(identity(track));artists.set(key,recordings)}
    return Math.max(0,...[...artists.values()].map(recordings=>recordings.size));
  }
  return new Set(eligible.map(identity)).size;
}
