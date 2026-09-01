import { semanticProfileSchema } from "./schema";

const listTags = {
  GENRE: "genre", STYLE: "style", MOOD: "mood", GROOVE: "groove",
  TEXTURE: "texture", TIMBRE: "timbre", PRODUCTION: "production",
  VOCALPROFILE: "vocalProfile", INSTRUMENTATION: "instrumentation",
  LANGUAGE: "languages", LYRICALTHEME: "lyricalThemes",
  LISTENINGCONTEXT: "listeningContexts", SCENE: "scenes", STYLEERA: "styleEra",
  METER: "meter", DYNAMICCHARACTER: "dynamicCharacter",
  STRUCTURALCHARACTER: "structuralCharacter", RECORDINGTYPE: "recordingTypes",
} as const;

const scalarTags = {
  VALENCE: "valence", ENERGY: "energy", BPM: "bpm", TEMPOFEEL: "tempoFeel",
  DANCEABILITY: "danceability", ACOUSTICELECTRONICCHARACTER: "acousticElectronicCharacter",
  MUSICALKEY: "musicalKey", MODE: "mode", TRACKDESCRIPTION: "summary",
} as const;

const special = new Map([
  ["r_and_b", "R&B"], ["hip_hop", "Hip-Hop"], ["drum_and_bass", "Drum & Bass"],
  ["rock_and_roll", "Rock & Roll"], ["lo_fi", "Lo-Fi"], ["4_4", "4/4"],
  ["3_4", "3/4"], ["6_8", "6/8"], ["12_8", "12/8"],
]);

function portable(value: string): string {
  const known = special.get(value.toLowerCase());
  if (known) return known;
  return value.replaceAll("_", " ").replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

export function semanticTagProperties(input: unknown): Record<string, string[]> {
  const parsed = semanticProfileSchema.safeParse(typeof input === "string" ? JSON.parse(input) : input);
  if (!parsed.success) return {};
  const profile = parsed.data as unknown as Record<string, unknown>;
  const properties: Record<string, string[]> = {};
  for (const [tag, field] of Object.entries(listTags)) {
    const values = profile[field];
    properties[tag] = Array.isArray(values) ? values.map(String).filter(Boolean).map(portable) : [];
  }
  for (const [tag, field] of Object.entries(scalarTags)) {
    const value = profile[field];
    properties[tag] = value === null || value === undefined || value === "" ? [] : [field === "bpm" || field === "summary" ? String(value) : portable(String(value))];
  }
  return properties;
}

export function mergeSemanticTagSnapshot(source: string, properties: Record<string, string[]>): string {
  const tags = JSON.parse(source) as Record<string, unknown>;
  const names: Record<string, string> = {
    GENRE: "genre", STYLE: "style", MOOD: "mood", SCENE: "scene", BPM: "bpm",
    VALENCE: "valence", ENERGY: "energy", TEMPOFEEL: "tempoFeel", GROOVE: "groove",
    DANCEABILITY: "danceability", TEXTURE: "texture", TIMBRE: "timbre",
    PRODUCTION: "production", ACOUSTICELECTRONICCHARACTER: "acousticElectronicCharacter",
    VOCALPROFILE: "vocalProfile", INSTRUMENTATION: "instrumentation", LANGUAGE: "languages",
    LYRICALTHEME: "lyricalThemes", LISTENINGCONTEXT: "listeningContexts", STYLEERA: "styleEra",
    MUSICALKEY: "musicalKey", MODE: "mode", METER: "meter",
    DYNAMICCHARACTER: "dynamicCharacter", STRUCTURALCHARACTER: "structuralCharacter",
    RECORDINGTYPE: "recordingTypes", TRACKDESCRIPTION: "trackDescription",
  };
  for (const [tag, values] of Object.entries(properties)) {
    const name = names[tag] ?? tag;
    tags[name] = values.length === 1 ? values[0] : values;
  }
  return JSON.stringify(tags);
}
