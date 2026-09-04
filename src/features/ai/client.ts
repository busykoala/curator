import OpenAI from "openai";
import type { ChatCompletionMessageParam,ChatCompletionTool } from "openai/resources/chat/completions";
import { config } from "@/config";
import { openWebPage,webSearch } from "./web-tools";

export type ReasoningEffort="low"|"medium"|"high";
export type ApiStyle="responses"|"chat";
export type JsonSchema=Record<string,unknown>;
export type AiUsage={input_tokens:number;output_tokens:number;total_tokens:number};
export type AiResult<T>={data:T;usage:AiUsage;sourceUrls?:Set<string>};
export type StructuredRequest={model:string;effort:ReasoningEffort;input:string;instructions?:string;schemaName:string;schema:JsonSchema;maxOutputTokens?:number;web?:boolean};
type ClientOptions={apiKey:string;baseURL?:string;style:ApiStyle};

const localTools:ChatCompletionTool[]=[
  {type:"function",function:{name:"web_search",description:"Search the current public web. Returns titles, source URLs, and result snippets.",strict:true,parameters:{type:"object",additionalProperties:false,required:["query"],properties:{query:{type:"string",description:"A concise search-engine query"}}}}},
  {type:"function",function:{name:"open_url",description:"Open one public HTTP(S) source page returned by web_search. Returns its title, description, readable text, and declared social-preview image URLs.",strict:true,parameters:{type:"object",additionalProperties:false,required:["url"],properties:{url:{type:"string",description:"A full public HTTP(S) URL from search results"}}}}},
];

function usage(input?:{prompt_tokens?:number;completion_tokens?:number;input_tokens?:number;output_tokens?:number;total_tokens?:number}|null):AiUsage{const inputTokens=Number(input?.input_tokens??input?.prompt_tokens??0),outputTokens=Number(input?.output_tokens??input?.completion_tokens??0);return{input_tokens:inputTokens,output_tokens:outputTokens,total_tokens:Number(input?.total_tokens??inputTokens+outputTokens)}}
function addUsage(left:AiUsage,right:AiUsage):AiUsage{return{input_tokens:left.input_tokens+right.input_tokens,output_tokens:left.output_tokens+right.output_tokens,total_tokens:left.total_tokens+right.total_tokens}}
function parse<T>(text:string|null):T{if(!text)throw new Error("AI response contained no structured output");return JSON.parse(text) as T}

export class CuratorAiClient{
  private readonly client:OpenAI;
  constructor(private readonly options:ClientOptions){this.client=new OpenAI({apiKey:options.apiKey||"missing",baseURL:options.baseURL})}

  async structured<T>(request:StructuredRequest):Promise<AiResult<T>>{
    return this.options.style==="chat"?this.chat<T>(request):this.responses<T>(request);
  }

  private async responses<T>(request:StructuredRequest):Promise<AiResult<T>>{
    const response=await this.client.responses.create({model:request.model,instructions:request.instructions,input:request.input,reasoning:{effort:request.effort},tools:request.web?[{type:"web_search",search_context_size:"low"}]:undefined,max_output_tokens:request.maxOutputTokens,store:false,text:{format:{type:"json_schema",name:request.schemaName,strict:true,schema:request.schema}}},{timeout:120_000,maxRetries:0});
    return{data:parse<T>(response.output_text),usage:usage(response.usage)};
  }

  private async chat<T>(request:StructuredRequest):Promise<AiResult<T>>{
    const messages:ChatCompletionMessageParam[]=[];
    if(request.instructions)messages.push({role:"system",content:request.instructions});
    if(request.web)messages.push({role:"system",content:"Research with web_search first, then open promising source pages before relying on claims or image URLs. If the request supplies preferred sourceDomains, search those domains before broadening. Only use URLs present in tool results and copy their exact strings, including query parameters; never invent or rewrite a URL. Do not give the final answer until the research tools are finished."});
    messages.push({role:"user",content:request.input});
    let total:AiUsage={input_tokens:0,output_tokens:0,total_tokens:0};const sourceUrls=new Set<string>();
    if(!request.web){const response=await this.client.chat.completions.create({model:request.model,messages,response_format:{type:"json_schema",json_schema:{name:request.schemaName,strict:true,schema:request.schema}},max_tokens:request.maxOutputTokens??4_096,temperature:0},{timeout:120_000,maxRetries:0}),choice=response.choices[0];if(!choice)throw new Error("AI response contained no choice");if(choice.finish_reason==="length")throw new Error("AI response exceeded its output-token limit");return{data:parse<T>(choice.message.content),usage:usage(response.usage)}}
    for(let turn=0;turn<5;turn+=1){
      const response=await this.client.chat.completions.create({model:request.model,messages,tools:localTools,tool_choice:turn===0?{type:"function",function:{name:"web_search"}}:"auto",max_tokens:1_200,temperature:0},{timeout:120_000,maxRetries:0});
      total=addUsage(total,usage(response.usage));const choice=response.choices[0];if(!choice)throw new Error("AI response contained no choice");
      const calls=(choice.message.tool_calls??[]).filter((call)=>call.type==="function");
      if(!calls.length){messages.push({role:"assistant",content:choice.message.content??""});break}
      messages.push({role:"assistant",content:choice.message.content??"",tool_calls:calls});
      for(const call of calls){
        let output:unknown;try{const args=JSON.parse(call.function.arguments) as Record<string,unknown>;if(call.function.name==="web_search"){output=await webSearch(String(args.query??""));for(const item of output as Awaited<ReturnType<typeof webSearch>>)sourceUrls.add(item.url)}else if(call.function.name==="open_url"){const url=String(args.url??"");if(!sourceUrls.has(url))throw new Error("open_url only accepts a URL returned by web_search");output=await openWebPage(url);const page=output as Awaited<ReturnType<typeof openWebPage>>;sourceUrls.add(page.url);for(const image of page.images)sourceUrls.add(image)}else throw new Error("Unknown tool") }catch(error){output={error:String(error)}}
        messages.push({role:"tool",tool_call_id:call.id,content:JSON.stringify(output)});
      }
    }
    messages.push({role:"user",content:"Using only the collected web evidence, return the final answer now. Output must match the required JSON schema."});
    const final=await this.client.chat.completions.create({model:request.model,messages,response_format:{type:"json_schema",json_schema:{name:request.schemaName,strict:true,schema:request.schema}},max_tokens:request.maxOutputTokens??4_096,temperature:0},{timeout:120_000,maxRetries:0}),choice=final.choices[0];
    total=addUsage(total,usage(final.usage));if(!choice)throw new Error("AI response contained no final choice");if(choice.finish_reason==="length")throw new Error("AI response exceeded its output-token limit");return{data:parse<T>(choice.message.content),usage:total,sourceUrls};
  }
}

export const aiApiKey=config.CURATOR_AI_API_KEY||config.OPENAI_API_KEY;
export const aiConfigured=Boolean(aiApiKey);
export const aiClient=new CuratorAiClient({apiKey:aiApiKey,baseURL:config.OPENAI_BASE_URL,style:config.OPENAI_API_STYLE});
export function modelFor(tier:"luna"|"terra"|"sol"):string{return config.OPENAI_MODEL||config[tier==="luna"?"OPENAI_LUNA_MODEL":tier==="terra"?"OPENAI_TERRA_MODEL":"OPENAI_SOL_MODEL"]}
export function tierModels(...tiers:Array<"luna"|"terra"|"sol">):string[]{return[...new Set(tiers.map(modelFor))]}
