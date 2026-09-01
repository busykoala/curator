export const semanticListFields = [
  "genre","style","mood","groove","texture","timbre","production",
  "vocalProfile","instrumentation","languages","lyricalThemes",
  "listeningContexts","scenes","styleEra","meter","dynamicCharacter",
  "structuralCharacter","recordingTypes",
] as const;

export type SemanticListField = typeof semanticListFields[number];
export type FiveLevel = "very_low"|"low"|"medium"|"high"|"very_high";
export type Valence = "very_dark"|"negative"|"bittersweet_or_neutral"|"positive"|"very_positive";
export type TempoFeel = "very_slow"|"slow"|"midtempo"|"brisk"|"fast"|"very_fast";
export type AcousticCharacter = "fully_acoustic"|"mostly_acoustic"|"acoustic_electronic_hybrid"|"mostly_electronic"|"fully_electronic";
export type TonalMode = "major"|"minor"|"modal"|"atonal"|"ambiguous"|"dorian"|"mixolydian"|"phrygian"|"lydian"|"locrian";

export type TrackSemanticProfile = {
  genre:string[]; style:string[]; mood:string[]; valence:Valence; energy:FiveLevel;
  bpm:number|null; tempoFeel:TempoFeel; groove:string[]; danceability:FiveLevel;
  texture:string[]; timbre:string[]; production:string[];
  acousticElectronicCharacter:AcousticCharacter; vocalProfile:string[];
  instrumentation:string[]; languages:string[]; lyricalThemes:string[];
  listeningContexts:string[]; scenes:string[]; styleEra:string[];
  musicalKey:string|null; mode:TonalMode|null; meter:string[];
  dynamicCharacter:string[]; structuralCharacter:string[]; recordingTypes:string[];
  summary:string; evidenceNotes:string[];
};

export type AudioFeatures = {
  analyzedSeconds:number; sampleRate:number; rmsDb:number; peakDb:number;
  dynamicRangeDb:number; zeroCrossingRate:number; highFrequencyRatio:number;
  estimatedBpm:number|null; tempoCandidates:number[]; beatRegularity:number; energy:number; danceability:number;
};

export type CategorizationFile = {
  id:number; path:string; albumKey:string; artist:string; album:string;
  format:string; inode:number; size:number; mtimeMs:number; sourceUpdatedAt:string;
  tags:Record<string,unknown>;
};

export type TrackClassificationInput = {
  file:CategorizationFile; audio:AudioFeatures; sourceFingerprint:string;
};

export type AlbumSemanticProfile = {
  genre:string[]; style:string[]; mood:string[]; production:string[]; scenes:string[];
  styleEra:string[]; texture:string[]; timbre:string[]; vocalProfile:string[];
  acousticElectronicCharacter:string[]; energyRange:string[];
  cohesion:"cohesive"|"varied"|"highly_varied"; tracks:number; summary:string;
};
