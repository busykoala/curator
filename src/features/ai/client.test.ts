import test from "node:test";
import assert from "node:assert/strict";
import { CuratorAiClient,type AiAttempt } from "./client";
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
test('identical calls with reordered argument keys execute once and stop the tool loop',async()=>{
  const original=globalThis.fetch;let requests=0,executions=0;
  globalThis.fetch=async()=>{
    requests++;
    return Response.json({choices:[{message:requests<3?{tool_calls:[{id:String(requests),type:'function',function:{name:'catalog',arguments:requests===1?'{"a":1,"b":2}':'{"b":2,"a":1}'}}]}:{content:'{"ok":true}'}}]});
  };
  try{
    await client.structured({input:'Pick',schemaName:'test',schema,tools:[{name:'catalog',description:'Read',parameters:{type:'object'},execute(){executions++;return{ids:[1]}}}]});
    assert.equal(executions,1);assert.equal(requests,3);
  }finally{globalThis.fetch=original}
});
test('an oversized tool batch cannot execute beyond the application budget',async()=>{
  const original=globalThis.fetch;let executions=0;
  globalThis.fetch=async()=>Response.json({choices:[{message:{tool_calls:Array.from({length:13},(_,i)=>({id:String(i),type:'function',function:{name:'catalog',arguments:JSON.stringify({i})}}))}}]});
  try{
    await assert.rejects(client.structured({input:'Pick',schemaName:'test',schema,maxToolCalls:100,tools:[{name:'catalog',description:'Read',parameters:{type:'object'},execute(){executions++}}]}),/tool-call budget/);
    assert.equal(executions,0);
  }finally{globalThis.fetch=original}
});
test('Retry-After delays retries and records failed-call usage and latency',async()=>{
  const original=globalThis.fetch,attempts:AiAttempt[]=[];let calls=0;
  globalThis.fetch=async()=>++calls===1?Response.json({error:'busy',usage:{prompt_tokens:2,completion_tokens:1,total_tokens:3}},{status:429,headers:{'Retry-After':'1'}}):Response.json({choices:[{message:{content:'{"ok":true}'}}],usage:{prompt_tokens:4,completion_tokens:2,total_tokens:6}});
  const started=Date.now();
  try{
    const result=await client.structured({input:'Pick',schemaName:'test',schema,onAttempt:attempt=>attempts.push(attempt)});
    assert.ok(Date.now()-started>=950);assert.equal(result.usage.total_tokens,9);assert.equal(attempts.length,2);
    assert.equal(attempts[0].outcome,'failed');assert.equal(attempts[0].httpStatus,429);assert.equal(attempts[0].usage?.total_tokens,3);assert.ok(attempts[0].durationMs>=0);
  }finally{globalThis.fetch=original}
});
test('the total deadline bounds Retry-After waits and a nonresponsive custom tool',async()=>{
  const original=globalThis.fetch,keepAlive=setTimeout(()=>undefined,1000);let calls=0;
  try{
    globalThis.fetch=async()=>{calls++;return new Response('Busy',{status:429,headers:{'Retry-After':'600'}})};
    await assert.rejects(client.structured({input:'Pick',schemaName:'test',schema,deadlineMs:20}),/timeout|aborted/i);assert.equal(calls,1);
    globalThis.fetch=async()=>Response.json({choices:[{message:{tool_calls:[{id:'one',type:'function',function:{name:'catalog',arguments:'{}'}}]}}]});
    await assert.rejects(client.structured({input:'Pick',schemaName:'test',schema,deadlineMs:20,tools:[{name:'catalog',description:'Read',parameters:{type:'object'},execute:()=>new Promise(()=>undefined)}]}),/timeout|aborted/i);
  }finally{clearTimeout(keepAlive);globalThis.fetch=original}
});
test('the application caps tool rounds even if a caller requests a larger loop',async()=>{
  const original=globalThis.fetch;let requests=0,executions=0;
  globalThis.fetch=async()=>{
    requests++;return Response.json({choices:[{message:requests<=6?{tool_calls:[{id:String(requests),type:'function',function:{name:'catalog',arguments:JSON.stringify({page:requests})}}]}:{content:'{"ok":true}'}}]});
  };
  try{
    await client.structured({input:'Pick',schemaName:'test',schema,maxToolTurns:99,tools:[{name:'catalog',description:'Read',parameters:{type:'object'},execute(){executions++;return{ids:[executions]}}}]});
    assert.equal(executions,6);assert.equal(requests,7);
  }finally{globalThis.fetch=original}
});
test('successful validation switches directly to structured output without another tool round',async()=>{
  const original=globalThis.fetch,requests:Array<Record<string,unknown>>=[];
  globalThis.fetch=async(_url,options)=>{requests.push(JSON.parse(String(options?.body)));return Response.json({choices:[{message:requests.length===1?{tool_calls:[{id:'validate',type:'function',function:{name:'validate_selection',arguments:'{}'}}]}:{content:'{"ok":true}'}}]})};
  try{
    await client.structured({input:'Compare supplied candidates',schemaName:'test',schema,firstTool:'validate_selection',finishAfterValidTool:'validate_selection',tools:[{name:'validate_selection',description:'Check',parameters:{type:'object'},execute:()=>({valid:true})}]});
    assert.equal(requests.length,2);assert.ok(requests[0].tools);assert.equal(requests[1].tools,undefined);assert.ok(requests[1].response_format);
  }finally{globalThis.fetch=original}
});
test('a bounded validation stage passes errors to final output without repeating distribution arithmetic',async()=>{
  const original=globalThis.fetch;let requests=0;
  globalThis.fetch=async()=>{requests++;return Response.json({choices:[{message:requests===1?{tool_calls:[{id:'validate',type:'function',function:{name:'validate_selection',arguments:'{}'}}]}:{content:'{"ok":true}'}}]})};
  try{
    await client.structured({input:'Compare supplied candidates',schemaName:'test',schema,firstTool:'validate_selection',finishAfterTool:'validate_selection',tools:[{name:'validate_selection',description:'Check',parameters:{type:'object'},execute:()=>({valid:false,errors:['Artist variety']})}]});
    assert.equal(requests,2);
  }finally{globalThis.fetch=original}
});
test('the first workflow stage advertises and executes only its declared tool',async()=>{
  const original=globalThis.fetch;let executed=false;
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(String(options?.body));assert.deepEqual(body.tools.map((tool:{function:{name:string}})=>tool.function.name),['requirements']);
    return Response.json({choices:[{message:{tool_calls:[{id:'wrong',type:'function',function:{name:'publish',arguments:'{}'}}]}}]});
  };
  try{
    await assert.rejects(client.structured({input:'Test staged tools',schemaName:'test',schema,firstTool:'requirements',tools:[{name:'requirements',description:'First',parameters:{type:'object'},execute:()=>({})},{name:'publish',description:'Other',parameters:{type:'object'},execute:()=>{executed=true}}]}),/outside the current workflow stage/);
    assert.equal(executed,false);
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
