import {musicalFitRubric} from './evaluation-cases';
import {buildTrackEvidence} from './track-evidence';
import {defaultConfig,type PlaylistConfig,type PlaylistCategory} from './types';
import type {EvidencedCandidate} from './selection-policy';
import type {ListenerSnapshot} from './listening-snapshot';

type Profile=Record<string,unknown>;
type Pair={category:PlaylistCategory;genre?:string;positive:Profile;negative:Profile;direction?:string;target?:number;previous?:boolean;mode?:string};
// Controlled reference attributes instantiate the fixed rubric. These are
// neither owned/library tracks nor externally verified metadata. Real-library
// metadata quality and the live 24x3 replay are separate gates. No native API
// may publish these fixture identities.
const trip={genre:['electronic'],style:['trip_hop'],mood:['dark','atmospheric','serene'],energy:'low'},piano={genre:['jazz'],instrumentation:['piano'],vocalProfile:['instrumental'],mood:['warm','peaceful'],energy:'low'},rock={genre:['rock'],instrumentation:['electric_guitar'],vocalProfile:['clean_sung'],energy:'high'};
const pairs:Record<string,Pair>={
  'late-trip-hop':{category:'mood',genre:'electronic',positive:trip,negative:{genre:['electronic'],style:['breakbeat'],mood:['aggressive'],energy:'very_high'}},
  'dark-downtempo':{category:'mood',genre:'electronic',positive:{...trip,style:['downtempo','trip_hop']},negative:{genre:['electronic'],style:['trance'],mood:['euphoric'],energy:'very_high'}},
  'warm-jazz':{category:'mood',genre:'jazz',positive:piano,negative:{genre:['jazz'],style:['free_jazz'],mood:['aggressive','intense'],energy:'very_high'}},
  'jazz-vocals':{category:'depth',genre:'jazz',positive:{...piano,vocalProfile:['clean_sung']},negative:piano},
  'piano-focus':{category:'mood',positive:{genre:['classical'],instrumentation:['piano'],vocalProfile:['instrumental'],mood:['serene','peaceful'],energy:'very_low'},negative:{genre:['jazz'],instrumentation:['piano'],vocalProfile:['clean_sung'],energy:'high'}},
  'quiet-rock':{category:'mood',positive:{genre:['folk_acoustic'],instrumentation:['acoustic_guitar'],mood:['reflective','introspective'],energy:'low'},negative:{...rock,genre:['metal'],mood:['aggressive'],energy:'very_high'}},
  'energetic-jazz':{category:'mood',genre:'jazz',positive:{...piano,instrumentation:['drums','trumpet','piano'],energy:'high',mood:['energetic','uplifting']},negative:{...piano,energy:'very_low'}},
  'ambient-sleep':{category:'mood',genre:'electronic',positive:{genre:['electronic'],style:['ambient'],vocalProfile:['instrumental'],mood:['serene'],energy:'very_low',listeningContexts:['sleep']},negative:{genre:['electronic'],style:['industrial'],instrumentation:['drums'],mood:['aggressive'],energy:'very_high'}},
  'electronic-drive':{category:'mood',genre:'electronic',positive:{genre:['electronic'],style:['minimal_techno'],mood:['hypnotic','reflective'],listeningContexts:['night_driving'],energy:'medium'},negative:{genre:['electronic'],style:['dubstep'],mood:['aggressive'],energy:'very_high'}},
  'festival-exclusion':{category:'depth',genre:'electronic',positive:{genre:['electronic'],style:['ambient'],mood:['serene'],energy:'very_low'},negative:{genre:['electronic'],style:['big_room_house'],energy:'very_high'}},
  'punk-nineties':{category:'depth',positive:{...rock,genre:['punk_hardcore'],style:['pop_punk'],originalYear:1994},negative:{...rock,genre:['metal'],originalYear:1991}},
  'artist-only':{category:'depth',genre:'rock',positive:rock,negative:{...rock,style:['pop_punk']}},
  'instrumental-jazz':{category:'depth',genre:'jazz',positive:piano,negative:{...piano,vocalProfile:['clean_sung']}},
  'piano-required':{category:'depth',genre:'jazz',positive:piano,negative:{genre:['jazz'],instrumentation:['tenor_saxophone','bass','drums'],vocalProfile:['instrumental']}},
  'acoustic-focus':{category:'depth',positive:{genre:['folk_acoustic'],instrumentation:['acoustic_guitar'],vocalProfile:['instrumental'],acousticElectronicCharacter:'acoustic'},negative:{genre:['electronic'],instrumentation:['synthesizer','drum_machine'],vocalProfile:['chant'],acousticElectronicCharacter:'electronic'}},
  'electronic-vs-electric':{category:'depth',positive:rock,negative:{genre:['electronic'],instrumentation:['synthesizer','drum_machine'],energy:'high'}},
  'morning-indie':{category:'mood',genre:'rock',positive:{...rock,style:['indie_pop'],mood:['playful','hopeful'],listeningContexts:['morning_commute'],energy:'medium'},negative:{...rock,style:['experimental_rock'],mood:['dark','aggressive'],energy:'high'}},
  'rainy-window':{category:'mood',positive:{genre:['folk_acoustic'],instrumentation:['acoustic_guitar'],mood:['reflective','melancholic'],energy:'low'},negative:{genre:['pop'],mood:['euphoric','playful'],energy:'high'}},
  'hopeful':{category:'mood',positive:{...rock,mood:['hopeful','uplifting'],valence:'positive',energy:'medium'},negative:{...rock,mood:['somber','melancholic'],valence:'negative',energy:'low'}},
  'no-spoken-word':{category:'depth',genre:'jazz',positive:piano,negative:{genre:['jazz'],vocalProfile:['spoken_word'],recordingTypes:['spoken_interlude']}},
  'studio-only':{category:'depth',genre:'rock',positive:{...rock,recordingTypes:['studio_recording']},negative:{...rock,recordingTypes:['live_recording']}},
  'live-only':{category:'depth',genre:'rock',positive:{...rock,recordingTypes:['live_recording']},negative:{...rock,recordingTypes:['studio_recording']}},
  'dedup-recording':{category:'depth',genre:'jazz',positive:piano,negative:piano,target:2,previous:true,mode:'dedup'},
  'preserve-remix':{category:'depth',genre:'electronic',positive:{...trip,recordingTypes:['remix']},negative:trip,target:2,previous:true,mode:'remix'},
  'original-era':{category:'depth',positive:{...rock,originalYear:1977},negative:{...rock,originalYear:2023}},
  'unheard-discovery':{category:'discovery',genre:'jazz',positive:piano,negative:piano,mode:'discovery'},
  'catalogue-discovery':{category:'discovery',genre:'jazz',positive:{...piano,originalYear:1972},negative:{...rock,originalYear:2026},mode:'discovery'},
  'adjacent-discovery':{category:'discovery',positive:{genre:['electronic'],style:['dub','downtempo'],mood:['hypnotic'],energy:'low'},negative:{genre:['metal'],mood:['aggressive'],energy:'very_high'},mode:'discovery'},
  'discovery-exposure':{category:'discovery',genre:'jazz',positive:piano,negative:piano,mode:'removed'},
  'rediscovery-known':{category:'rediscovery',genre:'jazz',positive:piano,negative:piano,mode:'history'},
  'rediscovery-recent':{category:'rediscovery',genre:'jazz',positive:piano,negative:piano,mode:'recent'},
  'rediscovery-track':{category:'rediscovery',genre:'jazz',positive:piano,negative:piano,mode:'history'},
  'stale-listening':{category:'discovery',genre:'jazz',positive:piano,negative:piano,mode:'stale'},
  'journey-opening':{category:'journey',genre:'rock',positive:{...rock,energy:'low'},negative:{genre:['electronic'],style:['ambient'],energy:'very_low'}},
  'journey-peak':{category:'journey',genre:'electronic',positive:{genre:['electronic'],style:['minimal_techno'],energy:'high'},negative:{...rock,genre:['metal'],energy:'high'}},
  'journey-landing':{category:'journey',genre:'electronic',positive:{genre:['electronic'],style:['ambient'],energy:'low'},negative:{genre:['electronic'],style:['techno'],energy:'very_high'},target:3,mode:'landing'},
  'journey-tempo':{category:'depth',genre:'electronic',positive:{genre:['electronic'],bpm:120},negative:{genre:['electronic'],bpm:240},direction:'Smooth transitions in musical tempo. Use only tracks with independently supported BPM between 110 and 130.',mode:'tempo'},
  'pin-correction':{category:'depth',genre:'jazz',positive:piano,negative:piano,target:3,previous:true,mode:'pins',direction:'Keep the first two current songs in exactly their current positions. Fill the last slot with another jazz song.'},
  'latest-exclusion':{category:'depth',genre:'jazz',positive:piano,negative:piano,mode:'exclude',direction:'Jazz as before, but exclude Rejected Artist now.'},
  'honest-shortage':{category:'depth',genre:'jazz',positive:piano,negative:{...piano,vocalProfile:['clean_sung'],instrumentation:['saxophone']},target:3,mode:'shortage'},
};
export function musicalFitFixtures(now:number){
  return musicalFitRubric.map((rubric,index)=>{
    const spec=pairs[rubric.id];if(!spec)throw Error('Missing fixed rubric fixture '+rubric.id);
    const make=(positive:boolean,id:number):EvidencedCandidate=>{
      const label=positive?rubric.positive:rubric.negative,parts=label.split(' — '),artist=parts.length>1?parts[0]:(positive?'Reference Artist':'Rejected Artist'),title=parts.slice(1).join(' — ')||label;
      const profile={...(positive?spec.positive:spec.negative)},originalYear=Number(profile.originalYear||0);delete profile.originalYear;
      const tags=spec.mode==='tempo'&&positive?{bpm:120}:{};
      const evidence=buildTrackEvidence({artist,title,tags,profile,manual:originalYear?{originalYear}:undefined});
      return{fileId:id,artist,title,album:'Controlled reference '+id,year:originalYear,profile,evidence,songId:'fixture-only-'+id,score:0,reason:'',origin:'catalog',exposureCount:0,removedAt:null,artistPlayCount:0,listener:{id:'fixture-only-'+id,title,artist,album:'Controlled reference '+id,playCount:0,hasPlayed:false,lastPlayed:null,favourite:false,rating:null,providerIds:{}}};
    };
    const positive=make(true,1000000000+index*10+1),negative=make(false,1000000000+index*10+2),pool=[positive,negative],previous:EvidencedCandidate[]=[];
    if(spec.mode==='discovery'){negative.listener!.hasPlayed=true;negative.listener!.playCount=1000;negative.listener!.lastPlayed=new Date(now-86400_000).toISOString();negative.artistPlayCount=1000}
    if(spec.mode==='removed')negative.removedAt=now-86400_000;
    if(['history','recent'].includes(spec.mode??'')){positive.listener!.hasPlayed=true;positive.listener!.playCount=40;positive.listener!.favourite=true;positive.listener!.lastPlayed=new Date(now-90*86400_000).toISOString()}
    if(spec.mode==='recent'){negative.listener!.hasPlayed=true;negative.listener!.playCount=100;negative.listener!.favourite=true;negative.listener!.lastPlayed=new Date(now-86400_000).toISOString()}
    if(spec.mode==='exclude'){negative.artist='Rejected Artist';negative.listener!.artist=negative.artist;negative.listener!.favourite=true}
    if(spec.mode==='landing')pool.push({...negative,fileId:negative.fileId+1,title:'Rhythmic middle',songId:negative.songId+'-middle',evidence:buildTrackEvidence({artist:negative.artist,title:'Rhythmic middle',tags:{},profile:{...negative.profile,energy:'medium'}})});
    if(spec.previous){
      const anchor=make(false,negative.fileId+1);anchor.title='Current anchor';anchor.artist='Current Artist';anchor.evidence=buildTrackEvidence({artist:anchor.artist,title:anchor.title,tags:{},profile:{...(spec.genre==='electronic'?trip:piano),recordingTypes:['studio_recording']}});pool.push(anchor);previous.push(anchor);
      if(spec.mode==='dedup'||spec.mode==='remix'){
        negative.artist=anchor.artist;negative.title=anchor.title;negative.evidence={...anchor.evidence};
        if(spec.mode==='remix'){positive.artist=anchor.artist;positive.title=anchor.title;positive.evidence=buildTrackEvidence({artist:positive.artist,title:positive.title,tags:{},profile:positive.profile})}
      }
      if(spec.mode==='pins'){previous.push(negative);pool.push({...positive,fileId:positive.fileId+5,title:'Another reference song',songId:positive.songId+'-other',evidence:buildTrackEvidence({artist:positive.artist,title:'Another reference song',tags:{},profile:piano})})}
    }
    const config:PlaylistConfig={...defaultConfig(spec.category),targetTracks:spec.target??1,genres:spec.genre?[spec.genre]:[],maxTracksPerArtist:8,maxTracksPerAlbum:5,rotationPercent:spec.mode==='dedup'||spec.mode==='remix'?30:100};
    const snapshot:ListenerSnapshot={songs:pool.map(track=>track.listener!),complete:spec.mode!=='stale',stale:spec.mode==='stale',capturedAt:new Date(now).toISOString(),error:'',available:true};
    return{rubric,spec,direction:spec.direction??rubric.direction,config,pool,previous,snapshot,positiveId:positive.fileId,negativeId:negative.fileId};
  });
}
