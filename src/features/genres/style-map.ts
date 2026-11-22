import discogsLabels from "./discogs400.json";

/** Broad browsing families written as the first GENRE value. */
export const FAMILIES = ["Rock","Pop","Electronic","Hip-Hop","Soul & R&B","Jazz","Blues","Classical","Folk","Country","Metal","Punk","Reggae","Latin","World","Soundtrack","Spoken Word","Children's"] as const;
export type Family = typeof FAMILIES[number];
export type Style = { key: string; display: string; family: Family; cluster: string; discogs?: string };

export const styleKey = (value: string) =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const any = (style: string, names: string) => names.split("|").some(name => styleKey(name) === styleKey(style));
const METAL = "Atmospheric Black Metal|Black Metal|Death Metal|Deathcore|Depressive Black Metal|Doom Metal|Folk Metal|Funeral Doom Metal|Funk Metal|Goregrind|Gothic Metal|Grindcore|Heavy Metal|Melodic Death Metal|Metalcore|Noisecore|Nu Metal|Pornogrind|Post-Metal|Power Metal|Progressive Metal|Sludge Metal|Speed Metal|Technical Death Metal|Thrash|Viking Metal";
const PUNK = "Crust|Emo|Hardcore|Melodic Hardcore|Oi|Pop Punk|Post-Hardcore|Power Violence|Psychobilly|Punk|Ska";
const COUNTRY = "Bluegrass|Cajun|Country|Hillbilly|Honky Tonk";
const FOLK = "Celtic|Folk|Neofolk|Nordic";

function discogsFamily(genre: string, style: string): Family {
  switch (genre) {
    case "Blues": return "Blues";
    case "Children's": return "Children's";
    case "Classical": return "Classical";
    case "Brass & Military": return "World";
    case "Electronic": return style === "Hip Hop" ? "Hip-Hop" : style === "Modern Classical" ? "Classical" : "Electronic";
    case "Folk, World, & Country": return any(style, COUNTRY) ? "Country" : any(style, FOLK) ? "Folk" : style === "Gospel" ? "Soul & R&B" : "World";
    case "Funk / Soul": return style === "Afrobeat" ? "World" : "Soul & R&B";
    case "Hip Hop": return style === "Trip Hop" ? "Electronic" : "Hip-Hop";
    case "Jazz": return style === "Afrobeat" ? "World" : "Jazz";
    case "Latin": return "Latin";
    case "Non-Music": return "Spoken Word";
    case "Pop": return "Pop";
    case "Reggae": return "Reggae";
    case "Rock": return any(style, METAL) ? "Metal" : any(style, PUNK) && style !== "Ska" ? "Punk" : style === "Ska" ? "Reggae" : style === "Lounge" ? "Pop" : "Rock";
    case "Stage & Screen": return "Soundtrack";
    default: return "World";
  }
}

/** Listening clusters: styles that sit comfortably next to each other in a playlist. */
const CLUSTERS: Array<[string, Family, string]> = [
  ["rock.classic", "Rock", "Classic Rock|Hard Rock|Blues Rock|Southern Rock|Arena Rock|AOR|Rock & Roll|Rockabilly|Glam|Pub Rock|Stoner Rock|Garage Rock|Beat|Mod|Surf|Twist|Doo Wop|Yé-Yé"],
  ["rock.alternative", "Rock", "Alternative Rock|Indie Rock|Brit Pop|Grunge|Post-Grunge|Lo-Fi|Shoegaze|Dream Pop|Post Rock|Math Rock|Noise|Post-Britpop|Jangle Pop"],
  ["rock.soft_folk", "Rock", "Soft Rock|Folk Rock|Country Rock|Acoustic|Acoustic Rock|Piano Rock"],
  ["rock.prog_psych", "Rock", "Prog Rock|Psychedelic Rock|Acid Rock|Art Rock|Krautrock|Space Rock|Symphonic Rock|Avantgarde|Experimental"],
  ["rock.pop_rock", "Rock", "Pop Rock|Power Pop"],
  ["rock.wave_goth", "Rock", "New Wave|Post-Punk|Coldwave|Goth Rock|Deathrock|Ethereal|No Wave|Industrial"],
  ["metal.heavy", "Metal", "Heavy Metal|Power Metal|Speed Metal|Thrash|Nu Metal|Funk Metal|Folk Metal|Viking Metal"],
  ["metal.prog_gothic", "Metal", "Progressive Metal|Post-Metal|Gothic Metal|Symphonic Metal"],
  ["punk.pop", "Punk", "Pop Punk|Emo|Ska Punk"],
  ["electronic.ambient", "Electronic", "Ambient|Dark Ambient|Drone|New Age|Berlin-School|Illbient|Dungeon Synth"],
  ["electronic.downtempo", "Electronic", "Downtempo|Trip Hop|Acid Jazz|Future Jazz|Chillwave|Leftfield|Abstract|Broken Beat|Jazzdance|Dub|Lounge|Chillout|Nu Jazz"],
  ["electronic.house", "Electronic", "EDM|Future Bass|House|Deep House|Tech House|Tropical House|Progressive House|Garage House|Acid House|Electro House|Italo House|Euro House|Hip-House|Tribal House|Ghetto House|Nu-Disco|Disco|Tribal|Bleep|Beatdown|Ghetto"],
  ["electronic.techno", "Electronic", "Techno|Minimal|Minimal Techno|Deep Techno|Dub Techno|Hard Techno|Schranz|Acid|New Beat|Melodic Techno"],
  ["electronic.trance", "Electronic", "Trance|Psy-Trance|Goa Trance|Progressive Trance|Hard Trance|Tech Trance"],
  ["electronic.bass", "Electronic", "Drum n Bass|Jungle|Dubstep|Breakbeat|Breaks|Big Beat|Bassline|UK Garage|Speed Garage|Grime|Halftime|Juke|Progressive Breaks"],
  ["electronic.synth", "Electronic", "Synth-pop|Synthwave|New Wave|Darkwave|Electroclash|Electro|EBM|Industrial|Vaporwave|Italo-Disco|Hi NRG|Eurobeat|Eurodance|Euro-Disco|Dance-pop|Freestyle|Disco Polo|Italodance"],
  ["electronic.experimental", "Electronic", "IDM|Glitch|Experimental|Noise|Musique Concrète|Sound Collage|Power Electronics|Rhythmic Noise|Breakcore|Chiptune"],
  ["electronic.hard", "Electronic", "Gabber|Hardcore|Hardstyle|Happy Hardcore|Speedcore|Jumpstyle|Makina|Donk|Hands Up"],
  ["jazz.vocal_swing", "Jazz", "Swing|Big Band|Dixieland|Ragtime|Easy Listening|Space-Age|Vocal Jazz|Jazz Standard|Jazz Pop|Traditional Pop"],
  ["jazz.cool_latin", "Jazz", "Cool Jazz|Bossa Nova|Latin Jazz|Afro-Cuban Jazz|Smooth Jazz"],
  ["jazz.fusion", "Jazz", "Fusion|Jazz-Funk|Jazz-Rock|Electro Swing"],
  ["jazz.avant", "Jazz", "Free Jazz|Avant-garde Jazz|Free Improvisation"],
  ["hiphop.jazzy", "Hip-Hop", "Jazzy Hip-Hop|Boom Bap|Conscious|Instrumental|Cut-up/DJ|Turntablism|Jazz Rap|Lo-Fi Hip Hop"],
  ["soul.contemporary", "Soul & R&B", "Contemporary R&B|Neo Soul|New Jack Swing|Swingbeat|UK Street Soul|RnB/Swing"],
  ["pop.vocal", "Pop", "Vocal|Ballad|Chanson|Schlager|Light Music|Music Hall|Lounge|Adult Contemporary"],
  ["pop.indie", "Pop", "Indie Pop|City Pop|Baroque Pop|Chamber Pop|Art Pop"],
  ["classical.early", "Classical", "Medieval|Renaissance|Baroque"],
  ["classical.modern", "Classical", "Modern|Contemporary|Post-Modern|Neo-Classical|Neo-Romantic|Modern Classical|Minimalism"],
  ["latin.brazil", "Latin", "Samba|Bossanova|MPB|Baião|Forró|Batucada"],
  ["latin.urban", "Latin", "Reggaeton|Latin Pop"],
];
function clusterOf(family: Family, display: string) {
  for (const [cluster, clusterFamily, names] of CLUSTERS) if (clusterFamily === family && any(display, names)) return cluster;
  const fallback: Partial<Record<Family, string>> = { Metal: "metal.extreme", Punk: "punk.hardcore", "Hip-Hop": "hiphop.main", "Soul & R&B": "soul.classic", Pop: "pop.main", Classical: "classical.common_practice", Latin: "latin.tropical", Jazz: "jazz.modern" };
  return fallback[family] ?? `${styleKey(family)}.main`;
}

/** Styles absent from Discogs' 400 labels but common in the LLM vocabulary. */
const EXTRA: Array<[string, Family]> = [
  ["Singer-Songwriter", "Folk"], ["Indie Folk", "Folk"], ["Contemporary Folk", "Folk"], ["Americana", "Country"], ["Alt-Country", "Country"],
  ["Post-Britpop", "Rock"], ["Jangle Pop", "Rock"], ["Piano Rock", "Rock"], ["Baroque Pop", "Pop"], ["Chamber Pop", "Pop"], ["Art Pop", "Pop"],
  ["Adult Contemporary", "Pop"], ["Traditional Pop", "Jazz"], ["Vocal Jazz", "Jazz"], ["Jazz Standard", "Jazz"], ["Jazz Pop", "Jazz"],
  ["Nu Jazz", "Electronic"], ["Chillout", "Electronic"], ["Melodic Techno", "Electronic"], ["Electro Swing", "Jazz"], ["Jazz Rap", "Hip-Hop"],
  ["Lo-Fi Hip Hop", "Hip-Hop"], ["Latin Pop", "Latin"], ["Ska Punk", "Punk"], ["Symphonic Metal", "Metal"], ["Minimalism", "Classical"],
  ["Film Score", "Soundtrack"], ["Audio Drama", "Spoken Word"], ["Narrative Fiction", "Spoken Word"], ["Stand-Up Comedy", "Spoken Word"],
  ["Classic Soul", "Soul & R&B"], ["Motown", "Soul & R&B"], ["Rock en Español", "Latin"], ["Neo-Psychedelia", "Rock"],
  ["Post-Grunge", "Rock"], ["Acoustic Rock", "Rock"], ["Girl Group", "Pop"], ["EDM", "Electronic"], ["Future Bass", "Electronic"],
  ["Nashville Sound", "Country"], ["Worldbeat", "World"],
];
/** LLM spellings that mean an existing style. */
const ALIASES: Record<string, string> = {
  drum_and_bass: "Drum n Bass", dnb: "Drum n Bass", britpop: "Brit Pop", synthpop: "Synth-pop", progressive_rock: "Prog Rock", hip_hop: "Hip Hop",
  rnb: "Contemporary R&B", r_and_b: "Rhythm & Blues", rhythm_and_blues: "Rhythm & Blues", psychedelic: "Psychedelic Rock", punk_rock: "Punk",
  post_rock: "Post Rock", rock_and_roll: "Rock & Roll", bossa: "Bossa Nova", neoclassical: "Neo-Classical", contemporary_classical: "Modern Classical",
  cinematic: "Score", orchestral: "Classical", film_soundtrack: "Soundtrack", ambient_electronic: "Ambient", dance_pop: "Dance-pop", trip_hop: "Trip Hop",
  lofi: "Lo-Fi", latin_rock: "Rock en Español", rock_en_espanol: "Rock en Español", jazz_hip_hop: "Jazzy Hip-Hop", soul_jazz: "Soul-Jazz",
  jazz_fusion: "Fusion", acid_rock: "Acid Rock", heavy_metal: "Heavy Metal", soundtrack_score: "Score", spoken_word: "Spoken Word", comedy: "Comedy",
  british_invasion: "Beat", beat_music: "Beat", merseybeat: "Beat", electropop: "Synth-pop", liquid_dnb: "Drum n Bass", neurofunk: "Drum n Bass",
  dark_wave: "Darkwave", future_garage: "UK Garage", symphonic_prog: "Prog Rock", son_cubano: "Son", chanson_francaise: "Chanson",
  trap_latino: "Reggaeton", lovers_rocks: "Lovers Rock", rumba_flamenca: "Flamenco", surf_instrumental: "Surf", poetry_reading: "Poetry",
  bitpop: "Chiptune", electropunk: "Electroclash", rave: "EDM", dance: "EDM", spiritual: "Gospel",
};

const styles = new Map<string, Style>();
const byDiscogs = new Map<string, Style>();
for (const label of discogsLabels as string[]) {
  const [genre, display] = label.split("---");
  const family = discogsFamily(genre, display);
  const style: Style = { key: styleKey(`${family}_${display}`), display, family, cluster: clusterOf(family, display), discogs: label };
  byDiscogs.set(label, style);
  const plain = styleKey(display);
  const existing = styles.get(plain);
  // Several genres share a style name ("Dub", "Disco"); keep the one first listed for plain lookups.
  if (!existing) styles.set(plain, style);
  styles.set(style.key, style);
}
for (const [display, family] of EXTRA) {
  const style: Style = { key: styleKey(`${family}_${display}`), display, family, cluster: clusterOf(family, display) };
  if (!styles.has(styleKey(display))) styles.set(styleKey(display), style);
  styles.set(style.key, style);
}
const familyByKey = new Map(FAMILIES.map(family => [styleKey(family), family]));
/** Broad family words used by the LLM's GENRE field and as compound heads. */
const FAMILY_WORDS: Record<string, Family> = {
  rock: "Rock", pop: "Pop", electronic: "Electronic", electronica: "Electronic", house: "Electronic", techno: "Electronic", trance: "Electronic", ambient: "Electronic",
  downtempo: "Electronic", hip: "Hip-Hop", hop: "Hip-Hop", rap: "Hip-Hop", soul: "Soul & R&B", rnb: "Soul & R&B", funk: "Soul & R&B", disco: "Soul & R&B",
  jazz: "Jazz", swing: "Jazz", bop: "Jazz", blues: "Blues", classical: "Classical", baroque: "Classical", opera: "Classical", folk: "Folk",
  country: "Country", americana: "Country", bluegrass: "Country", metal: "Metal", punk: "Punk", hardcore: "Punk", emo: "Punk", reggae: "Reggae",
  dub: "Reggae", ska: "Reggae", dancehall: "Reggae", latin: "Latin", salsa: "Latin", samba: "Latin", tango: "Latin", world: "World", african: "World",
  soundtrack: "Soundtrack", score: "Soundtrack", spoken: "Spoken Word", comedy: "Spoken Word", children: "Children's", childrens: "Children's",
  acoustic: "Folk", gospel: "Soul & R&B",
};
const LLM_GENRES: Record<string, Family> = {
  rnb_soul_funk: "Soul & R&B", folk_acoustic: "Folk", country_americana: "Country", punk_hardcore: "Punk", reggae_dub_ska: "Reggae",
  soundtrack_score: "Soundtrack", spoken_word_comedy: "Spoken Word", hip_hop: "Hip-Hop", experimental_avant_garde: "Electronic",
  religious_spiritual: "Soul & R&B", middle_eastern_north_african: "World", south_asian: "World", east_southeast_asian: "World", african: "World", childrens: "Children's",
};

export function styleFromDiscogs(label: string) { return byDiscogs.get(label); }

/** Resolve a free-text style (LLM, MusicBrainz tag) to a known style, preferring the hinted family. */
export function resolveStyle(value: string, familyHint?: Family): Style | undefined {
  const key = styleKey(value);
  if (!key) return undefined;
  if (familyHint) { const scoped = styles.get(styleKey(`${familyHint}_${value}`)); if (scoped) return scoped; }
  const direct = styles.get(key) ?? (ALIASES[key] ? styles.get(styleKey(ALIASES[key])) : undefined);
  if (direct) return direct;
  const family = familyOf(value);
  // A bare family word ("jazz", "electronic") is family evidence, not a style.
  if (!family || familyByKey.has(key) || FAMILY_WORDS[key] || LLM_GENRES[key]) return undefined;
  return { key: styleKey(`${family}_${value}`), display: titleCase(value), family, cluster: clusterOf(family, titleCase(value)) };
}

/**
 * Family of a free-text genre or style. Compound styles take the family of their
 * head word ("folk rock" is rock, "jazz rap" is hip-hop, "pop punk" is punk).
 */
export function familyOf(value: string): Family | undefined {
  const key = styleKey(value);
  if (!key) return undefined;
  const known = familyByKey.get(key) ?? LLM_GENRES[key] ?? styles.get(key)?.family ?? (ALIASES[key] ? styles.get(styleKey(ALIASES[key]))?.family : undefined);
  if (known) return known;
  if (/(^|_)trip_hop($|_)/.test(key)) return "Electronic";
  if (/(^|_)hip_hop($|_)/.test(key)) return "Hip-Hop";
  const words = key.split("_");
  for (let index = words.length - 1; index >= 0; index--) { const family = FAMILY_WORDS[words[index]]; if (family) return family; }
  return undefined;
}

const titleCase = (value: string) => value.replace(/[_-]+/g, " ").trim().replace(/\b\p{L}/gu, letter => letter.toUpperCase());
export function allStyles() { return [...new Set(styles.values())]; }
