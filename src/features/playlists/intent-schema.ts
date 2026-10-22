import {z} from 'zod';
import {canonicalSemanticField,canonicalSemanticValue} from '@/features/categorization/vocabulary';
import type {PlaylistDefinition} from './types';

const terms=z.array(z.string().trim().min(1).max(120)).max(30);
export const intentFields=['genre','style','mood','listeningContexts','instrumentation','vocalProfile','recordingTypes','languages','acousticElectronicCharacter'] as const;
export const semanticRequirementSchema=z.object({
  field:z.enum(intentFields),values:terms.min(1),match:z.enum(['any','all','none']),
});
export const playlistIntentSchema=z.object({
  version:z.literal(1),sourceRevision:z.string(),summary:z.string().max(2000),
  hard:z.object({
    requirements:z.array(semanticRequirementSchema).max(30),
    artists:terms,excludeArtists:terms,exclusions:terms,
    vocal:z.enum(['any','instrumental','vocals']),
    recording:z.enum(['any','live','studio']),
    minYear:z.number().int().min(0).max(2100),maxYear:z.number().int().min(0).max(2100),
    minBpm:z.number().min(0).max(400),maxBpm:z.number().min(0).max(400),
    favouritesOnly:z.boolean(),
  }),
  soft:z.object({styles:terms,moods:terms,contexts:terms,energy:z.enum(['any','very_low','low','medium','high','very_high']),valence:terms}),
  pinnedRecordings:z.array(z.object({fileId:z.number().int().positive(),recordingKey:z.string().max(300)})).max(100),
  positionLocks:z.array(z.object({fileId:z.number().int().positive(),position:z.number().int().min(0).max(99)})).max(100),
});
export type PlaylistIntent=z.infer<typeof playlistIntentSchema>;
export type SemanticRequirement=z.infer<typeof semanticRequirementSchema>;

export function configuredIntent(definition:PlaylistDefinition,revision:string):PlaylistIntent{
  const config=definition.config;
  return{version:1,sourceRevision:revision,summary:definition.intent,hard:{
    requirements:config.genres.length?[{field:'genre',values:config.genres,match:'any'}]:[],
    artists:[],excludeArtists:[],exclusions:config.exclusions,vocal:'any',recording:'any',
    minYear:0,maxYear:0,minBpm:0,maxBpm:0,favouritesOnly:false,
  },soft:{styles:config.tasteLanes,moods:config.moods,contexts:config.contexts,energy:'any',valence:[]},pinnedRecordings:[],positionLocks:[]};
}

export function canonicalIntent(intent:PlaylistIntent):PlaylistIntent{
  const result=playlistIntentSchema.parse(intent);
  result.hard.requirements=result.hard.requirements.map(rule=>({...rule,field:canonicalSemanticField(rule.field) as SemanticRequirement['field'],
    // Keep specific styles: canonicalising trip-hop to broad electronic would
    // silently weaken an explicit musical requirement.
    values:[...new Set(rule.values.map(value=>canonicalSemanticValue(rule.field==='genre'?'style':rule.field,value)))],
  }));
  for(const key of ['styles','moods','contexts'] as const){
    const field=key==='styles'?'style':key==='moods'?'mood':'listeningContexts';
    result.soft[key]=[...new Set(result.soft[key].map(value=>canonicalSemanticValue(field,value)))];
  }
  if(result.hard.minYear&&result.hard.maxYear&&result.hard.minYear>result.hard.maxYear)throw Error('Conflicting original-year requirements');
  if(result.hard.minBpm&&result.hard.maxBpm&&result.hard.minBpm>result.hard.maxBpm)throw Error('Conflicting tempo requirements');
  if(new Set(result.positionLocks.map(lock=>lock.position)).size!==result.positionLocks.length)throw Error('Two songs cannot occupy the same locked position');
  return result;
}
