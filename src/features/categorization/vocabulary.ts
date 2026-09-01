import type { TrackSemanticProfile } from "./types";
import { semanticListFields } from "./types";
import { controlledValues } from "./canonical";

const aliases:Record<string,string>={
  "hip-hop":"hip_hop",hiphop:"hip_hop","r&b":"rnb_soul_funk",rnb:"rnb_soul_funk",
  "drum & bass":"drum_and_bass",dnb:"drum_and_bass","liquid drum and bass":"liquid_dnb",
  synth_pop:"synthpop",indie:"indie_rock","alternative & indie":"alternative_rock",
  "alternatif et inde":"alternative_rock","alternativa e indie":"alternative_rock",
  "musiques du monde":"world",electronica:"electronic",soundtracks:"soundtrack_score",
  "four-on-the-floor":"four_on_floor","lo-fi":"lo_fi","hi-fi":"hi_fi",
  instrumental_music:"instrumental",singer_songwriters:"singer_songwriter",
};

const fieldAliases:Record<string,Record<string,string>>={
  groove:{four_on_the_floor:"four_on_floor",straight_rock:"straight",straight_rock_beat:"straight",steady_backbeat:"straight",backbeat:"straight",rock_backbeat:"straight",backbeat_driven:"straight",steady_rock:"straight",steady_rock_beat:"straight",driving:"straight",driving_rock:"straight",driving_rock_beat:"straight",riff_driven:"straight",slow_backbeat:"half_time",laid_back:"half_time",loose_live_groove:"swing",one_drop:"reggae_one_drop",offbeat_skank:"reggae_one_drop"},
  instrumentation:{electric_guitars:"electric_guitar",drums:"acoustic_drums",drum_kit:"acoustic_drums",electric_bass:"bass_guitar",bass:"bass_guitar",synth:"synthesizer",synths:"synthesizer",keyboards:"keyboard",lead_vocals:"voice"},
  meter:{common_time:"4_4",variable_meter:"mixed_meter",irregular_meter:"odd_meter"},
  structuralCharacter:{verse_chorus_form:"verse_chorus",loop_based:"repetitive_loop",repeated_loop:"repetitive_loop",ambient_evolution:"ambient_evolving",improvised_jam:"jam_improvised",multi_section_suite:"suite_multi_section"},
  recordingTypes:{studio_album_recording:"studio_recording",studio_track:"studio_recording",instrumental_recording:"standard_track",alternate_mix:"alternate_version",radio_version:"radio_edit",extended_version:"extended_mix"},
  vocalProfile:{sung_vocals:"clean_sung",rap_vocals:"rap",shouted_accents:"powerful",spoken_vocals:"spoken",group_voices:"mixed_vocal_styles"},
  production:{processed:"heavily_processed",electronic_processing:"heavily_processed"},
  mood:{melancholy:"melancholic",dreamlike:"dreamy",dream_like:"dreamy",eerie_mysterious:"eerie"},
};

const languageAliases:Record<string,string>={english:"English",french:"French",german:"German",spanish:"Spanish",portuguese:"Portuguese",italian:"Italian",japanese:"Japanese",korean:"Korean",arabic:"Arabic",jamaican_patois:"Jamaican Patois",jamaican_english:"Jamaican English"};
const instrumentTokens=new Set(["electric_guitar","electric_guitars","acoustic_guitar","bass_guitar","electric_bass","drums","drum_kit","acoustic_drums","organ","piano","keyboards","keyboard","synthesizer","saxophone","flute","brass","strings"]);
const roleTokens=new Set(["opener","closer","builder","peak","playlist_opener","playlist_closer"]);

export function canonicalToken(value:unknown):string{
  const text=String(value??"").normalize("NFKC").trim().toLowerCase();if(!text)return"";
  const mapped=aliases[text]??text;
  return mapped.replace(/&/g," and ").replace(/['\u2019]/g,"").replace(/[^\p{L}\p{N}]+/gu,"_").replace(/^_+|_+$/g,"").replace(/_+/g,"_");
}

export function normalizeList(values:unknown,max:number):string[]{
  const source=Array.isArray(values)?values:String(values??"").split(/[;,|]/);
  return[...new Set(source.map(canonicalToken).filter(Boolean))].slice(0,max);
}

function genre(value:string):string{
  if(/soundtrack|score/.test(value))return"soundtrack_score";if(/spoken|comedy/.test(value))return"spoken_word_comedy";if(/religious|spiritual|gospel/.test(value))return"religious_spiritual";if(/child/.test(value))return"childrens";
  if(/latin|salsa|cumbia|reggaeton|samba|bossa|tango/.test(value))return"latin";if(/afro|african|highlife|soukous|amapiano/.test(value))return"african";if(/arab|middle_east|rai|gnawa|anatolian|persian/.test(value))return"middle_eastern_north_african";if(/south_asian|bollywood|hindustani|carnatic|qawwali|bhangra/.test(value))return"south_asian";if(/east_asian|j_pop|k_pop|cantopop|mandopop|gamelan/.test(value))return"east_southeast_asian";
  if(/metal/.test(value))return"metal";if(/punk|hardcore|emo|screamo/.test(value))return"punk_hardcore";if(/reggae|dub|ska|dancehall|rocksteady/.test(value))return"reggae_dub_ska";if(/hip_hop|(^|_)rap($|_)|trap|drill|grime/.test(value))return"hip_hop";if(/rnb|soul|funk|motown|disco|boogie/.test(value))return"rnb_soul_funk";if(/jazz|swing|bebop/.test(value))return"jazz";if(/classical|baroque|opera|orchestral|chamber|choral/.test(value))return"classical";if(/country|americana|bluegrass|honky_tonk/.test(value))return"country_americana";if(/folk|acoustic|singer_songwriter/.test(value))return"folk_acoustic";
  if(/ambient|drone|new_age/.test(value))return"ambient";if(/experimental|avant|noise|musique_concrete|sound_art/.test(value))return"experimental_avant_garde";if(/electronic|house|techno|trance|electro|breakbeat|jungle|drum_and_bass|garage|dubstep|synthwave|industrial|ebm|idm|glitch/.test(value))return"electronic";if(/pop/.test(value))return"pop";if(/rock|alternative|indie|grunge|shoegaze|krautrock/.test(value))return"rock";return value;
}

function production(value:string):string{
  if(/studio.*polish|polish.*studio/.test(value))return"studio_polished";if(/polish/.test(value))return"polished";if(/compress/.test(value))return"compressed";if(/lo_fi|lo_fidel/.test(value))return"lo_fi";if(/hi_fi|high_fidel/.test(value))return"hi_fi";if(/reverb/.test(value))return"reverb_heavy";if(/delay/.test(value))return"delay_heavy";if(/spacious|wide_stereo/.test(value))return"spacious";if(/analog/.test(value))return"analog_feel";if(/digital.*clean|clean.*digital/.test(value))return"digital_clean";if(/sample/.test(value))return"sample_based";if(/heavy.*process/.test(value))return"heavily_processed";if(/live.*feel|live_band/.test(value))return"live_feel";if(/\bdry\b/.test(value))return"dry";if(/\braw\b/.test(value))return"raw";if(/dynamic/.test(value))return"dynamic";if(/vintage/.test(value))return"vintage";if(/modern/.test(value))return"modern";return value;
}

function dynamic(value:string):string{if(/compress/.test(value))return"compressed";if(/crescendo|gradual_build/.test(value))return"crescendo_build";if(/episodic|contrast|variable/.test(value))return"episodic";if(/highly_dynamic|wide_dynamic/.test(value))return"highly_dynamic";if(/moderate/.test(value))return"moderately_dynamic";if(/steady|consistent/.test(value))return"steady";return value}
function groove(value:string):string{if(/four.*floor/.test(value))return"four_on_floor";if(/breakbeat|broken_beat/.test(value))return"breakbeat";if(/syncopat/.test(value))return"syncopated";if(/shuffle/.test(value))return"shuffle";if(/swing|loose_live/.test(value))return"swing";if(/half_time|laid_back|slow_backbeat/.test(value))return"half_time";if(/double_time/.test(value))return"double_time";if(/motorik/.test(value))return"motorik";if(/funk/.test(value))return"funk_groove";if(/latin|clave/.test(value))return"latin_clave";if(/reggae|one_drop|offbeat_skank/.test(value))return"reggae_one_drop";if(/dancehall/.test(value))return"dancehall";if(/trap|triplet/.test(value))return"trap_triplet";if(/poly/.test(value))return"polyrhythmic";if(/rubato/.test(value))return"rubato";if(/free|irregular/.test(value))return"free_time";if(/straight|steady|backbeat|driving|rock.*pulse|pulse.*rock|measured|restrained|riff_driven/.test(value))return"straight";return value}
function era(value:string):string{const decade=value.match(/(?:19|20)\d0s/)?.[0];if(decade)return decade;const year=value.match(/\b(19|20)\d{2}\b/)?.[0];if(year)return year.slice(0,3)+"0s";if(value.includes("pre_1950"))return"pre_1950s";if(value.includes("contemporary"))return"contemporary";return"era_ambiguous"}
function vocal(value:string):string{if(/(^|_)(male|female|man|woman|english|french|spanish)(_|$)/.test(value)||value==="lead_vocals"||value==="lead_vocal")return"clean_sung";if(/autotune|auto_tune|vocoder/.test(value))return"vocoder_autotune";return value}
function recording(value:string):string{if(roleTokens.has(value))return"";if(/studio/.test(value))return"studio_recording";if(/live/.test(value))return"live_recording";if(/demo/.test(value))return"demo";if(/alternate_take/.test(value))return"alternate_take";if(/alternate/.test(value))return"alternate_version";if(/acoustic/.test(value))return"acoustic_version";if(/extended.*mix/.test(value))return"extended_mix";if(/radio/.test(value))return"radio_edit";if(/remix/.test(value))return"remix";if(/cover/.test(value))return"cover_version";if(/interlude/.test(value))return"interlude";if(/intro/.test(value))return"intro";if(/outro/.test(value))return"outro";if(/reprise/.test(value))return"reprise";if(/skit/.test(value))return"skit";if(/spoken/.test(value))return"spoken_piece";if(/medley/.test(value))return"medley";return value}
function sanitizeText(value:unknown):string{return String(value??"").normalize("NFKC").replace(/\b(?:album\s+)?(?:opener|closer|builder|peak)\b/gi,"track").replace(/\b(?:male|female|man|woman)(?:-fronted)?\b/gi,"").replace(/\s+([,.;:])/g,"$1").replace(/\s+/g," ").trim()}
function sanitizeSummary(value:unknown):string{return sanitizeText(value).slice(0,360)}

function normalizeField(field:string,value:unknown,max:number):string[]{
  if(field==="languages")return[...new Set((Array.isArray(value)?value:[]).map(item=>languageAliases[canonicalToken(item)]??String(item).normalize("NFKC").trim()).filter(Boolean))].slice(0,max);
  let values=normalizeList(value,max*2);if(field==="genre")values=values.map(genre);if(field==="groove")values=values.map(groove);if(field==="production")values=values.map(production);if(field==="dynamicCharacter")values=values.map(dynamic);if(field==="styleEra")values=values.map(era);if(field==="vocalProfile")values=values.map(vocal);if(field==="recordingTypes")values=values.map(recording);if(field==="timbre")values=values.filter(item=>!instrumentTokens.has(item));if(field==="mood")values=values.filter(item=>!/^very_(?:low|high)_energy$|^(?:low|high)_energy$|^energetic$/.test(item));
  const map=fieldAliases[field];if(map)values=values.map(item=>map[item]??item);return controlledValues(field,[...new Set(values.filter(Boolean))]).slice(0,max);
}

export function normalizeProfile(profile:TrackSemanticProfile):TrackSemanticProfile{
  const output={...profile} as TrackSemanticProfile,record=output as unknown as Record<string,unknown>;
  for(const field of semanticListFields){const max=field==="instrumentation"?10:field==="lyricalThemes"||field==="listeningContexts"?6:5;record[field]=normalizeField(field,record[field],max)}
  output.musicalKey=profile.musicalKey?String(profile.musicalKey).normalize("NFKC").trim():null;output.summary=sanitizeSummary(profile.summary);output.evidenceNotes=[...new Set(profile.evidenceNotes.map(value=>sanitizeText(value).slice(0,180)).filter(Boolean))].slice(0,6);return output;
}

export function profileIsSparse(profile:TrackSemanticProfile):boolean{
  if(!profile.genre.length||!profile.style.length||!profile.mood.length||!profile.texture.length||!profile.timbre.length||!profile.production.length)return true;
  const rhythmOptional=profile.genre.includes("spoken_word_comedy")||profile.recordingTypes.some(value=>["spoken_piece","skit"].includes(value))||profile.style.some(value=>/studio_chatter|spoken_announcement|ambient|drone|field_recording|free_form/.test(value));
  return !rhythmOptional&&!profile.groove.length;
}
