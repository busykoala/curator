import { config } from "@/config";
import { openWebPage,webSearch } from "./web-tools";

export type JsonSchema=Record<string,unknown>;
export type AiUsage={input_tokens:number;output_tokens:number;total_tokens:number};
export type AiResult<T>={data:T;usage:AiUsage;sourceUrls?:Set<string>};
export type StructuredRequest={input:string;instructions?:string;schemaName:string;schema:JsonSchema;maxOutputTokens?:number;web?:boolean};
export type AiClientOptions={apiKey:string;baseURL:string;model:string};

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

class AiHttpError extends Error{constructor(readonly status:number,message:string){super(message);this.name="AiHttpError"}}
function usage(input?:ChatResponse["usage"]):AiUsage{const inputTokens=Number(input?.prompt_tokens??0),outputTokens=Number(input?.completion_tokens??0);return{input_tokens:inputTokens,output_tokens:outputTokens,total_tokens:Number(input?.total_tokens??inputTokens+outputTokens)}}
function addUsage(left:AiUsage,right:AiUsage):AiUsage{return{input_tokens:left.input_tokens+right.input_tokens,output_tokens:left.output_tokens+right.output_tokens,total_tokens:left.total_tokens+right.total_tokens}}
function parse<T>(value:string|null|undefined):T{if(!value)throw new Error("AI response contained no structured output");return JSON.parse(value) as T}

export class CuratorAiClient{
  private readonly endpoint:string;
  constructor(private readonly options:AiClientOptions){this.endpoint=`${options.baseURL.replace(/\/+$/g,"")}/chat/completions`}

  private async completion(body:Record<string,unknown>):Promise<ChatResponse>{
    let lastError:unknown;
    for(let attempt=0;attempt<3;attempt+=1){
      try{
        const response=await fetch(this.endpoint,{method:"POST",headers:{Authorization:`Bearer ${this.options.apiKey||"missing"}`,"Content-Type":"application/json"},body:JSON.stringify({model:this.options.model,...body}),signal:AbortSignal.timeout(600_000)}),text=await response.text();
        if(!response.ok)throw new AiHttpError(response.status,`Local AI request failed (${response.status}): ${text.slice(0,500)}`);
        try{return JSON.parse(text) as ChatResponse}catch{throw new Error("Local AI returned invalid JSON")}
      }catch(error){
        lastError=error;const status=Number((error as {status?:number})?.status??0),retryable=!status||status===408||status===409||status===429||status>=500;
        if(!retryable||attempt===2)throw error;
        await new Promise((resolve)=>setTimeout(resolve,500*(attempt+1)));
      }
    }
    throw lastError;
  }

  async structured<T>(request:StructuredRequest):Promise<AiResult<T>>{
    const messages:ChatMessage[]=[];
    if(request.instructions)messages.push({role:"system",content:request.instructions});
    if(request.web)messages.push({role:"system",content:"Research with web_search first, then open promising source pages before relying on claims or image URLs. If the request supplies preferred sourceDomains, search those domains before broadening. A search result alone is not evidence: cite only source pages successfully returned by open_url. Copy URLs exactly, including query parameters; never invent or rewrite a URL. Do not give the final answer until the research tools are finished."});
    messages.push({role:"user",content:request.input});
    if(!request.web){
      const response=await this.completion({messages,response_format:{type:"json_schema",json_schema:{name:request.schemaName,strict:true,schema:request.schema}},max_tokens:request.maxOutputTokens??4_096,temperature:0}),choice=response.choices?.[0];
      if(!choice)throw new Error("Local AI response contained no choice");
      if(choice.finish_reason==="length")throw new Error("Local AI response exceeded its output-token limit");
      return{data:parse<T>(choice.message.content),usage:usage(response.usage)};
    }
    let total:AiUsage={input_tokens:0,output_tokens:0,total_tokens:0};const discoveredUrls=new Set<string>(),sourceUrls=new Set<string>();
    for(let turn=0;turn<5;turn+=1){
      const response=await this.completion({messages,tools:localTools,tool_choice:turn===0?{type:"function",function:{name:"web_search"}}:"auto",max_tokens:1_200,temperature:0});
      total=addUsage(total,usage(response.usage));const choice=response.choices?.[0];if(!choice)throw new Error("Local AI response contained no choice");
      const calls=choice.message.tool_calls??[];
      if(!calls.length){messages.push({role:"assistant",content:choice.message.content??""});break}
      messages.push({role:"assistant",content:choice.message.content??"",tool_calls:calls});
      for(const call of calls){
        let output:unknown;try{const args=JSON.parse(call.function.arguments) as Record<string,unknown>;if(call.function.name==="web_search"){output=await webSearch(String(args.query??""));for(const item of output as Awaited<ReturnType<typeof webSearch>>)discoveredUrls.add(item.url)}else if(call.function.name==="open_url"){const url=String(args.url??"");if(!discoveredUrls.has(url))throw new Error("open_url only accepts a URL returned by web_search");output=await openWebPage(url);const page=output as Awaited<ReturnType<typeof openWebPage>>;sourceUrls.add(url);sourceUrls.add(page.url);for(const image of page.images)sourceUrls.add(image)}else throw new Error("Unknown tool")}catch(error){output={error:String(error)}}
        messages.push({role:"tool",tool_call_id:call.id,content:JSON.stringify(output)});
      }
    }
    messages.push({role:"user",content:"Using only the collected web evidence, return the final answer now. Output must match the required JSON schema."});
    const final=await this.completion({messages,response_format:{type:"json_schema",json_schema:{name:request.schemaName,strict:true,schema:request.schema}},max_tokens:request.maxOutputTokens??4_096,temperature:0}),choice=final.choices?.[0];
    total=addUsage(total,usage(final.usage));if(!choice)throw new Error("Local AI response contained no final choice");if(choice.finish_reason==="length")throw new Error("Local AI response exceeded its output-token limit");return{data:parse<T>(choice.message.content),usage:total,sourceUrls};
  }
}

export const aiModel=config.CURATOR_AI_MODEL;
export const aiConfigured=Boolean(config.CURATOR_AI_API_KEY);
export const aiClient=new CuratorAiClient({apiKey:config.CURATOR_AI_API_KEY,baseURL:config.CURATOR_AI_BASE_URL,model:aiModel});
