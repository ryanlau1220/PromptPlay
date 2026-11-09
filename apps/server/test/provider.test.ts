import { expect, test } from "bun:test";
import { createProvider, mockProvider } from "../src/provider";
test("live provider is disabled by default", () => {
  expect(() => createProvider({liveEnabled:false, endpoint:"https://cloud-api.near.ai/v1", model:"zai-org/GLM-5.1-FP8", apiKey:""})).toThrow("disabled");
});
test("mock is deterministic and explicitly labeled", async () => {
  expect(await mockProvider().complete([{role:"user", content:"hello"}], 10)).toEqual({text:"Mock response", inputTokens:2, outputTokens:2, finishReason:"stop"});
});
test('provider model must be advertised before enabling redemption', async () => {
  const { verifyProviderModel } = await import('../src/provider')
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){return request.headers.get('authorization')==='Bearer test-key' ? Response.json({data:[{id:'available-model'}]}) : new Response('',{status:401})}})
  try {
    const config={liveEnabled:true,endpoint:`http://127.0.0.1:${server.port}`,model:'available-model',apiKey:'test-key'}
    await expect(verifyProviderModel(config)).resolves.toBeUndefined()
    await expect(verifyProviderModel({...config,model:'missing-model'})).rejects.toThrow('unavailable')
  } finally {server.stop()}
})
test('provider streams split SSE frames and requests usage for tool calls',async()=>{
 let sent:{stream_options?:unknown; tools?:unknown[]} = {}
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){sent=await req.json() as typeof sent;const enc=new TextEncoder();return new Response(new ReadableStream({start(c){for(const part of ['data: {"choices":[{"delta":{"tool_calls":[{"index":0}]}}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\r','\n\r\ndata: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}\r\n\r\ndata: [DONE]\r\n\r\n'])c.enqueue(enc.encode(part));c.close()}}),{headers:{'content-type':'text/event-stream'}})}})
 try{
  const provider=createProvider({liveEnabled:true,endpoint:`http://127.0.0.1:${server.port}`,model:'test-model',apiKey:'test-key'}),events=[]
  if (!provider.stream) throw new Error('Provider does not support streaming')
  for await(const event of provider.stream([{role:'user',content:'test'}],10,{tools:[{type:'function'}]}))events.push(event)
  expect(sent.stream_options).toEqual({include_usage:true});expect(sent.tools).toHaveLength(1);expect(events).toHaveLength(3);expect(events[2]?.usage).toEqual({inputTokens:3,outputTokens:2})
 }finally{server.stop()}
})

test('OpenAI-compatible provider forwards chat options and preserves tool calls and usage',async()=>{
 const received:{authorization?:string|null;body?:unknown}={}
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){received.authorization=req.headers.get('authorization');received.body=await req.json();return Response.json({choices:[{message:{content:null,tool_calls:[{id:'call_1',type:'function',function:{name:'read_file',arguments:'{}'}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:7,completion_tokens:3}})}})
 try{
  const provider=createProvider({liveEnabled:true,endpoint:`http://127.0.0.1:${server.port}/v1`,model:'test-model',apiKey:'server-secret'})
  const result=await provider.complete([{role:'user',content:'read a file'}],20,{tools:[{type:'function',function:{name:'read_file'}}],tool_choice:'auto'})
  expect(received.authorization).toBe('Bearer server-secret')
  expect(received.body).toMatchObject({model:'test-model',max_tokens:20,stream:false,tool_choice:'auto'})
  expect(result).toMatchObject({text:null,finishReason:'tool_calls',inputTokens:7,outputTokens:3,toolCalls:[{id:'call_1'}]})
 }finally{server.stop()}
})

test('OpenAI-compatible provider rejects a response without valid usage',async()=>{
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return Response.json({choices:[{message:{content:'ok'},finish_reason:'stop'}],usage:{prompt_tokens:4}})}})
 try{
  const provider=createProvider({liveEnabled:true,endpoint:`http://127.0.0.1:${server.port}`,model:'test-model',apiKey:'server-secret'})
  await expect(provider.complete([{role:'user',content:'hello'}],10)).rejects.toThrow('usage')
 }finally{server.stop()}
})

test('an interrupted upstream stream keeps the gateway reservation',async()=>{
 const {Database}=await import('bun:sqlite'),{Accounting}=await import('../src/accounting'),{GatewayKeys}=await import('../src/keys'),{Gateway}=await import('../src/gateway')
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return new Response('data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":2}}\n\n',{headers:{'content-type':'text/event-stream'}})}})
 const db=new Database(':memory:')
 try{
  const provider=createProvider({liveEnabled:true,endpoint:`http://127.0.0.1:${server.port}`,model:'test-model',apiKey:'server-secret'})
  const ledger=new Accounting(db,1000),keys=new GatewayKeys(db);ledger.creditReceipt('r','i','alice',1000);const key=keys.create('alice',1000)
  const gateway=new Gateway(ledger,keys,provider,'test-model',{inputMicrosPerMillion:1000000,outputMicrosPerMillion:2000000,microsPerUnit:1000000,contextTokens:100,maxOutputTokens:10},'Mock',{streaming:true,toolCalls:false})
  await expect(new Response(gateway.stream(key.key,'test-model',[{role:'user',content:'hello'}],10)).text()).rejects.toThrow()
  expect(ledger.usage('alice')[0]).toMatchObject({state:'reserved',reserved:120})
 }finally{server.stop();db.close()}
})

test('accepts final reported usage with an empty choice after finish, without treating interim usage as final',async()=>{
 const enc=new TextEncoder()
 const frames=[
  {choices:[{delta:{},index:0}],usage:{prompt_tokens:3,completion_tokens:0}},
  {choices:[{delta:{content:'ok'},index:0,finish_reason:'stop'}]},
  {choices:[{delta:{},index:0}],usage:{prompt_tokens:3,completion_tokens:2}},
 ]
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return new Response(new ReadableStream({start(c){for(const frame of frames)c.enqueue(enc.encode(`data: ${JSON.stringify(frame)}\n\n`));c.enqueue(enc.encode('data: [DONE]\n\n'));c.close()}}),{headers:{'content-type':'text/event-stream'}})}})
 try{
  const provider=createProvider({liveEnabled:true,endpoint:`http://127.0.0.1:${server.port}`,model:'test-model',apiKey:'test-key'}),events=[]
  if(!provider.stream)throw new Error('Provider does not support streaming')
  for await(const event of provider.stream([{role:'user',content:'test'}],10))events.push(event)
  expect(events).toHaveLength(4);expect(events[0]?.usage).toBeUndefined();expect(events[3]?.usage).toEqual({inputTokens:3,outputTokens:2})
 }finally{server.stop()}
})

test('does not settle on an early usage frame with a choice before finish',async()=>{
 const enc=new TextEncoder(),frame={choices:[{delta:{},index:0}],usage:{prompt_tokens:3,completion_tokens:0}}
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return new Response(new ReadableStream({start(c){c.enqueue(enc.encode(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`));c.close()}}),{headers:{'content-type':'text/event-stream'}})}})
 try{
  const provider=createProvider({liveEnabled:true,endpoint:`http://127.0.0.1:${server.port}`,model:'test-model',apiKey:'test-key'}),events=[]
  if(!provider.stream)throw new Error('Provider does not support streaming')
  for await(const event of provider.stream([{role:'user',content:'test'}],10))events.push(event)
  expect(events).toHaveLength(1);expect(events[0]?.usage).toBeUndefined()
 }finally{server.stop()}
})

test('does not treat usage as final when provider emits more content afterward',async()=>{
 const enc=new TextEncoder(),frames=[{choices:[],usage:{prompt_tokens:3,completion_tokens:1}},{choices:[{delta:{content:'late'},index:0}]}]
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return new Response(new ReadableStream({start(c){for(const frame of frames)c.enqueue(enc.encode(`data: ${JSON.stringify(frame)}\n\n`));c.enqueue(enc.encode('data: [DONE]\n\n'));c.close()}}),{headers:{'content-type':'text/event-stream'}})}})
 try{
  const provider=createProvider({liveEnabled:true,endpoint:`http://127.0.0.1:${server.port}`,model:'test-model',apiKey:'test-key'})
  if(!provider.stream)throw new Error('Provider does not support streaming')
  const events=[];for await(const event of provider.stream([{role:'user',content:'test'}],10))events.push(event)
  expect(events).toHaveLength(2);expect(events.every(event=>event.usage===undefined)).toBe(true)
 }finally{server.stop()}
})

test('uses the last final usage report without forwarding duplicate accounting events',async()=>{
 const enc=new TextEncoder(),frames=[{choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:3,completion_tokens:1}},{choices:[],usage:{prompt_tokens:3,completion_tokens:2}}]
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return new Response(new ReadableStream({start(c){for(const frame of frames)c.enqueue(enc.encode(`data: ${JSON.stringify(frame)}\n\n`));c.enqueue(enc.encode('data: [DONE]\n\n'));c.close()}}),{headers:{'content-type':'text/event-stream'}})}})
 try{
  const provider=createProvider({liveEnabled:true,endpoint:`http://127.0.0.1:${server.port}`,model:'test-model',apiKey:'test-key'}),events=[]
  if(!provider.stream)throw new Error('Provider does not support streaming')
  for await(const event of provider.stream([{role:'user',content:'test'}],10))events.push(event)
  expect(events.filter(event=>event.usage)).toHaveLength(1);expect(events.at(-1)?.usage).toEqual({inputTokens:3,outputTokens:2})
 }finally{server.stop()}
})

test('uses the newest provider usage when final usage frames have different choice shapes',async()=>{
 const enc=new TextEncoder(),frames=[{choices:[],usage:{prompt_tokens:3,completion_tokens:1}},{choices:[{index:0,delta:{}}],usage:{prompt_tokens:3,completion_tokens:2}}]
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return new Response(new ReadableStream({start(c){for(const frame of frames)c.enqueue(enc.encode(`data: ${JSON.stringify(frame)}\n\n`));c.enqueue(enc.encode('data: [DONE]\n\n'));c.close()}}),{headers:{'content-type':'text/event-stream'}})}})
 try{
  const provider=createProvider({liveEnabled:true,endpoint:`http://127.0.0.1:${server.port}`,model:'test-model',apiKey:'test-key'}),events=[]
  if(!provider.stream)throw new Error('Provider does not support streaming')
  for await(const event of provider.stream([{role:'user',content:'test'}],10))events.push(event)
  expect(events.filter(event=>event.usage)).toHaveLength(1);expect(events.at(-1)?.usage).toEqual({inputTokens:3,outputTokens:2})
 }finally{server.stop()}
})
