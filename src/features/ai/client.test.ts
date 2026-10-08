import test from "node:test";
import assert from "node:assert/strict";
import { CuratorAiClient } from "./client";
const client=new CuratorAiClient({apiKey:"private-test-key",baseURL:"http://localhost/v1",model:"test"});
const schema={type:"object",additionalProperties:false,required:["ok"],properties:{ok:{type:"boolean"}}};

test("custom tools execute locally, recover malformed arguments, and aggregate all inference usage",async()=>{
  const original=globalThis.fetch,requests:Array<Record<string,unknown>>=[];
  let executions=0;
  globalThis.fetch=async (_url,options)=>{
    requests.push(JSON.parse(String(options?.body)));
    const index=requests.length;
    return Response.json({choices:[{message:index===1?{content:null,tool_calls:[{id:"one",type:"function",function:{name:"catalog",arguments:'{"query":"jazz"}'}},{id:"two",type:"function",function:{name:"catalog",arguments:'invalid JSON'}}]}:{content:'{"ok":true}'}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});
  };
  try{
    const response=await client.structured<{ok:boolean}>({input:"Pick music",schemaName:"test",schema,firstTool:"catalog",tools:[{name:"catalog",description:"Library",parameters:{type:"object"},execute(args){executions++;assert.equal(args.query,"jazz");return{ids:[1]}}}]});
    assert.equal(executions,1);assert.equal(response.data.ok,true);assert.equal(response.usage.total_tokens,45);
    const messages=requests[1].messages as Array<{role:string;content:string}>;
    assert.ok(messages.some(item=>item.role==="tool"&&item.content.includes('"ids":[1]')));
    assert.ok(messages.some(item=>item.role==="tool"&&item.content.includes('"error"')));
  }finally{globalThis.fetch=original}
});
test("a shared output budget prevents tool responses from overflowing the model context",async()=>{
  const original=globalThis.fetch,requests:Array<Record<string,unknown>>=[];
  globalThis.fetch=async (_url,options)=>{
    requests.push(JSON.parse(String(options?.body)));
    return Response.json({choices:[{message:requests.length===1?{tool_calls:[{id:"one",type:"function",function:{name:"catalog",arguments:"{}"}}]}:{content:'{"ok":true}'}}]});
  };
  try{
    await client.structured({input:"Pick music",schemaName:"test",schema,maxToolResultCharacters:100,tools:[{name:"catalog",description:"Library",parameters:{type:"object"},execute:()=>({data:"x".repeat(10000)})}]});
    const messages=requests[1].messages as Array<{role:string;content:string}>;
    const output=messages.find(item=>item.role==="tool")?.content??"";
    assert.ok(output.includes("context budget"));assert.ok(output.length<200);
  }finally{globalThis.fetch=original}
});
