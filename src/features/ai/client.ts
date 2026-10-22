import { config } from "@/config";
import { openWebPage,webSearch } from "./web-tools";
import {runSharedInference} from './scheduler';

export type JsonSchema=Record<string,unknown>;
export type AiUsage={input_tokens:number;output_tokens:number;total_tokens:number};
export type AiResult<T>={data:T;usage:AiUsage;sourceUrls?:Set<string>};
export type AiTool={name:string;description:string;parameters:JsonSchema;execute:(args:Record<string,unknown>)=>unknown|Promise<unknown>};
export type AiAttempt={durationMs:number;httpStatus:number|null;outcome:'success'|'failed';usage:AiUsage|null;error?:string};
export type StructuredRequest={input:string;instructions?:string;schemaName:string;schema:JsonSchema;maxOutputTokens?:number;web?:boolean;tools?:AiTool[];firstTool?:string;finishAfterValidTool?:string;finishAfterTool?:string;maxToolTurns?:number;maxToolCalls?:number;maxToolResultCharacters?:number;signal?:AbortSignal;deadlineMs?:number;priority?:'interactive'|'background';onAttempt?:(attempt:AiAttempt)=>void};
export type AiClientOptions={apiKey:string;baseURL:string;model:string;runCompletion?:typeof runSharedInference};

type FunctionTool={type:"function";function:{name:string;description:string;strict:true;parameters:JsonSchema}};
type ToolCall={id:string;type:"function";function:{name:string;arguments:string}};
type ChatMessage=
  |{role:"system"|"user";content:string}
  |{role:"assistant";content:string;tool_calls?:ToolCall[]}
  |{role:"tool";tool_call_id:string;content:string};
type ChatResponse={
  choices?:Array<{finish_reason?:string;message:{content?:string|null;tool_calls?:ToolCall[]}}>;
  usage?:{prompt_tokens?:number;completion_tokens?:number;total_tokens?:number};
};

const localTools:FunctionTool[]=[
  {type:"function",function:{name:"web_search",description:"Search the current public web. Returns titles, source URLs, and result snippets.",strict:true,parameters:{type:"object",additionalProperties:false,required:["query"],properties:{query:{type:"string",description:"A concise search-engine query"}}}}},
  {type:"function",function:{name:"open_url",description:"Open one public HTTP(S) source page returned by web_search. Returns its title, description, readable text, and declared social-preview image URLs.",strict:true,parameters:{type:"object",additionalProperties:false,required:["url"],properties:{url:{type:"string",description:"A full public HTTP(S) URL from search results"}}}}},
];

class AiHttpError extends Error{constructor(readonly status:number,message:string,readonly retryAfterMs=0){super(message);this.name="AiHttpError"}}
let unavailableUntil=0,unavailableReason="";
export function aiCooldownRemaining():number{return Math.max(0,unavailableUntil-Date.now())}
function usage(input?:ChatResponse["usage"]):AiUsage{const inputTokens=Number(input?.prompt_tokens??0),outputTokens=Number(input?.completion_tokens??0);return{input_tokens:inputTokens,output_tokens:outputTokens,total_tokens:Number(input?.total_tokens??inputTokens+outputTokens)}}
function addUsage(left:AiUsage,right:AiUsage):AiUsage{return{input_tokens:left.input_tokens+right.input_tokens,output_tokens:left.output_tokens+right.output_tokens,total_tokens:left.total_tokens+right.total_tokens}}
function parse<T>(value:string|null|undefined):T{if(!value)throw new Error("AI response contained no structured output");return JSON.parse(value) as T}
function retryAfter(value:string|null){if(!value)return 0;const seconds=Number(value);return Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(value)-Date.now())||0}
function abortable<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
  if(signal.aborted){void operation.catch(()=>undefined);return Promise.reject(signal.reason)}
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
    operation.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
function pause(ms:number,signal:AbortSignal){
  signal.throwIfAborted();return new Promise<void>((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(signal.reason)},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},ms);
    signal.addEventListener('abort',abort,{once:true});
  });
}
function stable(value:unknown):string{
  if(Array.isArray(value))return'['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object')return'{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>JSON.stringify(key)+':'+stable(v)).join(',')+'}';
  return JSON.stringify(value);
}

export class CuratorAiClient{
  private readonly endpoint:string;
  constructor(private readonly options:AiClientOptions){this.endpoint=`${options.baseURL.replace(/\/+$/g,"")}/chat/completions`}

  private async completion(body:Record<string,unknown>,signal:AbortSignal,onAttempt?:StructuredRequest['onAttempt'],priority:NonNullable<StructuredRequest['priority']>='background'):Promise<ChatResponse>{
    if(aiCooldownRemaining()>0)throw new AiHttpError(503,unavailableReason||"Local AI model route is temporarily unavailable");
    let lastError:unknown;
    for(let attempt=0;attempt<3;attempt+=1){
      const started=Date.now();let httpStatus:number|null=null,attemptUsage:AiUsage|null=null;
      try{
        signal.throwIfAborted();
        const transport=async(transportSignal:AbortSignal)=>{
          const response=await abortable(fetch(this.endpoint,{method:"POST",headers:{Authorization:`Bearer ${this.options.apiKey||"missing"}`,"Content-Type":"application/json"},body:JSON.stringify({model:this.options.model,...body}),signal:transportSignal}),transportSignal);
          return{response,text:await abortable(response.text(),transportSignal)};
        };
        const {response,text}=await(this.options.runCompletion?this.options.runCompletion(transport,signal,priority):transport(signal));
        httpStatus=response.status;
        let parsed:ChatResponse|undefined;try{parsed=JSON.parse(text) as ChatResponse;if(parsed.usage)attemptUsage=usage(parsed.usage)}catch{/* Some upstream errors are plain text. */}
        if(!response.ok){const message=`Local AI request failed (${response.status}): ${text.slice(0,500)}`;if(response.status===404&&/no router for requested model/i.test(text)){unavailableUntil=Date.now()+15*60_000;unavailableReason=message}throw new AiHttpError(response.status,message,retryAfter(response.headers.get('retry-after')))}
        if(!parsed)throw new Error('Local AI returned invalid JSON');
        onAttempt?.({durationMs:Date.now()-started,httpStatus,outcome:'success',usage:attemptUsage});return parsed;
      }catch(error){
        onAttempt?.({durationMs:Date.now()-started,httpStatus,outcome:'failed',usage:attemptUsage,error:String(error).slice(0,300)});
        lastError=error;const status=Number((error as {status?:number})?.status??0),retryable=!status||status===408||status===409||status===429||status>=500;
        if(signal.aborted||(error as {inferenceYield?:boolean})?.inferenceYield||!retryable||attempt===2)throw error;
        await pause(Math.max((error as AiHttpError).retryAfterMs??0,500*(attempt+1)),signal);
      }
    }
    throw lastError;
  }

  async structured<T>(request:StructuredRequest):Promise<AiResult<T>>{
    const deadline=AbortSignal.timeout(Math.max(1,Math.min(240_000,request.deadlineMs??240_000)));
    const signal=request.signal?AbortSignal.any([request.signal,deadline]):deadline;
    let total:AiUsage={input_tokens:0,output_tokens:0,total_tokens:0};
    const onAttempt=(attempt:AiAttempt)=>{if(attempt.usage)total=addUsage(total,attempt.usage);try{request.onAttempt?.(attempt)}catch{/* Metrics must not break inference. */}};
    const messages:ChatMessage[]=[];
    if(request.instructions)messages.push({role:"system",content:request.instructions});
    if(request.web)messages.push({role:"system",content:(request.tools?.length?"When public-web research is useful, use web_search, then open promising source pages before relying on claims.":"Research with web_search first, then open promising source pages before relying on claims or image URLs.")+" If the request supplies preferred sourceDomains, search those domains before broadening. A search result alone is not evidence: cite only source pages successfully returned by open_url. Copy URLs exactly, including query parameters; never invent or rewrite a URL. Do not give the final answer until the research tools are finished."});
    messages.push({role:"user",content:request.input});
    if(!request.web&&!request.tools?.length){
      const response=await this.completion({messages,response_format:{type:"json_schema",json_schema:{name:request.schemaName,strict:true,schema:request.schema}},max_tokens:request.maxOutputTokens??4_096,temperature:0},signal,onAttempt,request.priority),choice=response.choices?.[0];
      if(!choice)throw new Error("Local AI response contained no choice");
      if(choice.finish_reason==="length")throw new Error("Local AI response exceeded its output-token limit");
      return{data:parse<T>(choice.message.content),usage:total};
    }
    const discoveredUrls=new Set<string>(),sourceUrls=new Set<string>(),executed=new Set<string>();
    const toolDefinitions:FunctionTool[]=[...(request.tools??[]).map(tool=>({type:"function" as const,function:{name:tool.name,description:tool.description,strict:true as const,parameters:tool.parameters}})),...(request.web?localTools:[])];
    let toolCalls=0,remainingToolCharacters=request.maxToolResultCharacters??Infinity;
    let repeated=false,validated=false;
    for(let turn=0;turn<Math.min(6,request.maxToolTurns??6);turn+=1){
      const firstTool=request.firstTool??(request.web?"web_search":undefined);
      // Some local template/parser combinations treat named tool_choice as
      // advisory. Advertise only the permitted first-stage function as well.
      const availableTools=turn===0&&firstTool?toolDefinitions.filter(tool=>tool.function.name===firstTool):toolDefinitions;
      const response=await this.completion({messages,tools:availableTools,tool_choice:turn===0&&firstTool?{type:"function",function:{name:firstTool}}:"auto",max_tokens:1_200,temperature:0},signal,onAttempt,request.priority);
      const choice=response.choices?.[0];if(!choice)throw new Error("Local AI response contained no choice");
      const calls=choice.message.tool_calls??[];
      if(!calls.length){messages.push({role:"assistant",content:choice.message.content??""});break}
      if(toolCalls+calls.length>Math.min(12,request.maxToolCalls??12))throw Error('AI exceeded the tool-call budget');
      messages.push({role:"assistant",content:choice.message.content??"",tool_calls:calls});
      for(const call of calls){
        if(!availableTools.some(tool=>tool.function.name===call.function.name))throw Error('AI called a tool outside the current workflow stage');
        let output:unknown;try{toolCalls++;const args=JSON.parse(call.function.arguments) as Record<string,unknown>,key=call.function.name+':'+stable(args);if(executed.has(key)){repeated=true;throw Error('Identical tool call already attempted; finish from the collected evidence')}executed.add(key);const custom=request.tools?.find(tool=>tool.name===call.function.name);if(custom)output=await abortable(Promise.resolve().then(()=>custom.execute(args)),signal);else if(request.web&&call.function.name==="web_search"){output=await abortable(webSearch(String(args.query??"")),signal);for(const item of output as Awaited<ReturnType<typeof webSearch>>)discoveredUrls.add(item.url)}else if(request.web&&call.function.name==="open_url"){const url=String(args.url??"");if(!discoveredUrls.has(url))throw new Error("open_url only accepts a URL returned by web_search");output=await abortable(openWebPage(url),signal);const page=output as Awaited<ReturnType<typeof openWebPage>>;sourceUrls.add(url);sourceUrls.add(page.url);for(const image of page.images)sourceUrls.add(image)}else throw new Error("Unknown tool")}catch(error){signal.throwIfAborted();output={error:String(error)}}
        let content=JSON.stringify(output);
        if(call.function.name===request.finishAfterValidTool&&(output as {valid?:boolean}|null)?.valid===true)validated=true;
        if(call.function.name===request.finishAfterTool)validated=true;
        if(content.length>remainingToolCharacters)content=JSON.stringify({error:"Tool result exceeds the remaining context budget. Use the evidence already collected to finish."});
        remainingToolCharacters=Math.max(0,remainingToolCharacters-content.length);
        messages.push({role:"tool",tool_call_id:call.id,content});
      }
      if(validated||repeated||toolCalls>=Math.min(12,request.maxToolCalls??12))break;
    }
    messages.push({role:"user",content:"Using only the collected tool evidence and supplied context, return the final answer now. Output must match the required JSON schema."});
    const final=await this.completion({messages,response_format:{type:"json_schema",json_schema:{name:request.schemaName,strict:true,schema:request.schema}},max_tokens:request.maxOutputTokens??4_096,temperature:0},signal,onAttempt,request.priority),choice=final.choices?.[0];
    if(!choice)throw new Error("Local AI response contained no final choice");if(choice.finish_reason==="length")throw new Error("Local AI response exceeded its output-token limit");return{data:parse<T>(choice.message.content),usage:total,sourceUrls};
  }
}

export const aiModel=config.CURATOR_AI_MODEL;
export const aiConfigured=Boolean(config.CURATOR_AI_API_KEY);
export const aiClient=new CuratorAiClient({apiKey:config.CURATOR_AI_API_KEY,baseURL:config.CURATOR_AI_BASE_URL,model:aiModel,runCompletion:runSharedInference});
