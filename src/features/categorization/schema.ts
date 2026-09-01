import { z } from "zod";

const list=(max:number)=>z.array(z.string().min(1).max(60)).max(max);
const notes=z.array(z.string().min(1).max(180)).max(6);
const level=z.enum(["very_low","low","medium","high","very_high"]);
export const semanticProfileSchema=z.object({
  genre:list(3),style:list(5),mood:list(5),
  valence:z.enum(["very_dark","negative","bittersweet_or_neutral","positive","very_positive"]),
  energy:level,bpm:z.number().min(20).max(300).nullable(),
  tempoFeel:z.enum(["very_slow","slow","midtempo","brisk","fast","very_fast"]),
  groove:list(4),danceability:level,texture:list(4),timbre:list(5),production:list(5),
  acousticElectronicCharacter:z.enum(["fully_acoustic","mostly_acoustic","acoustic_electronic_hybrid","mostly_electronic","fully_electronic"]),
  vocalProfile:list(4),instrumentation:list(10),languages:list(4),lyricalThemes:list(6),
  listeningContexts:list(6),scenes:list(3).min(1),styleEra:list(3),musicalKey:z.string().max(20).nullable(),
  mode:z.enum(["major","minor","modal","atonal","ambiguous","dorian","mixolydian","phrygian","lydian","locrian"]).nullable(),
  meter:list(3),dynamicCharacter:list(3),structuralCharacter:list(4),recordingTypes:list(4),
  summary:z.string().max(360),evidenceNotes:notes,
}).strict();

export const semanticBatchSchema=z.object({tracks:z.array(z.object({fileId:z.number().int().positive(),profile:semanticProfileSchema}).strict()).min(1).max(8)}).strict();

const stringList=(maxItems:number)=>({type:"array",items:{type:"string",minLength:1,maxLength:60},maxItems});
const required=["genre","style","mood","valence","energy","bpm","tempoFeel","groove","danceability","texture","timbre","production","acousticElectronicCharacter","vocalProfile","instrumentation","languages","lyricalThemes","listeningContexts","scenes","styleEra","musicalKey","mode","meter","dynamicCharacter","structuralCharacter","recordingTypes","summary","evidenceNotes"];
const profileJsonSchema={type:"object",additionalProperties:false,required,properties:{
  genre:stringList(3),style:stringList(5),mood:stringList(5),
  valence:{type:"string",enum:["very_dark","negative","bittersweet_or_neutral","positive","very_positive"]},
  energy:{type:"string",enum:["very_low","low","medium","high","very_high"]},
  bpm:{type:["number","null"],minimum:20,maximum:300},
  tempoFeel:{type:"string",enum:["very_slow","slow","midtempo","brisk","fast","very_fast"]},
  groove:stringList(4),danceability:{type:"string",enum:["very_low","low","medium","high","very_high"]},
  texture:stringList(4),timbre:stringList(5),production:stringList(5),
  acousticElectronicCharacter:{type:"string",enum:["fully_acoustic","mostly_acoustic","acoustic_electronic_hybrid","mostly_electronic","fully_electronic"]},
  vocalProfile:stringList(4),instrumentation:stringList(10),languages:stringList(4),lyricalThemes:stringList(6),
  listeningContexts:stringList(6),scenes:{...stringList(3),minItems:1},styleEra:stringList(3),
  musicalKey:{type:["string","null"],maxLength:20},
  mode:{type:["string","null"],enum:["major","minor","modal","atonal","ambiguous","dorian","mixolydian","phrygian","lydian","locrian",null]},
  meter:stringList(3),dynamicCharacter:stringList(3),structuralCharacter:stringList(4),recordingTypes:stringList(4),
  summary:{type:"string",maxLength:360},evidenceNotes:{type:"array",items:{type:"string",minLength:1,maxLength:180},maxItems:6},
}};
export const semanticBatchJsonSchema={type:"object",additionalProperties:false,required:["tracks"],properties:{tracks:{type:"array",minItems:1,maxItems:8,items:{type:"object",additionalProperties:false,required:["fileId","profile"],properties:{fileId:{type:"integer",minimum:1},profile:profileJsonSchema}}}}};
