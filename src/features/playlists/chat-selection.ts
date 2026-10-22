import type {CuratorAiClient} from '@/features/ai/client';
import type {PlaylistDefinition} from './types';
import type {ChatResult} from './chat-state';
import type {ChatIntentContext} from './intent-compiler';
import type {ListenerSnapshot} from './listening-snapshot';
import type {RetrievalProvider} from './retrieval';
import {generateIntentSelection} from './selection-repository';

// Interpretation and selection run before conversation state is committed.
// The caller holds the shared mutation lease and fences the conversation revision.
export async function suggestIntentChatPlaylist(definition:PlaylistDefinition,state:ChatIntentContext,message:string,targetTracks:number,
  options:{client?:Pick<CuratorAiClient,'structured'>;snapshot?:ListenerSnapshot;provider?:RetrievalProvider;signal?:AbortSignal}={}){
  const context:ChatIntentContext={...state,revision:state.revision+1,messages:[...state.messages,{role:'user',content:message}]};
  const generated=await generateIntentSelection({...definition,config:{...definition.config,targetTracks}},{...options,chat:context,interactive:true});
  if(generated.evaluation.violations.length)throw Error(generated.evaluation.violations.join('; '));
  const usage={input_tokens:0,output_tokens:0,total_tokens:0};
  for(const detail of [generated.detail.intent,...generated.detail.ai]){
    const value=detail.usage as typeof usage|undefined;if(value)for(const key of ['input_tokens','output_tokens','total_tokens'] as const)usage[key]+=value[key]??0;
  }
  let reply=generated.evaluation.shortage?`Found ${generated.items.length} suitable songs; ${generated.evaluation.shortage} more would be needed. Your musical requirements are preserved.`:
    `Updated your mix. ${generated.intent.summary}`.slice(0,1000);
  const unavailable=generated.detail.trackRequests.unavailable;
  if(unavailable.length)reply+=` Could not match under the saved requirements: ${unavailable.slice(0,3).map(name=>name.slice(0,140)).join('; ')}${unavailable.length>3?`; and ${unavailable.length-3} more`:''}.`;
  const result:ChatResult={name:definition.name,reply,guidance:generated.intent.summary,items:generated.items.map(item=>({...item,retained:Boolean(item.retained)})),
    detail:{tracks:generated.items.length,pending:generated.evaluation.shortage,durationMs:generated.detail.latencyMs,usage,tools:[],intent:generated.intent}};
  return{result,generated};
}
