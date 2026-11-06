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
 let sent:any
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){sent=await req.json();const enc=new TextEncoder();return new Response(new ReadableStream({start(c){for(const part of ['data: {"choices":[{"delta":{"tool_calls":[{"index":0}]}}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\r','\n\r\ndata: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}\r\n\r\ndata: [DONE]\r\n\r\n'])c.enqueue(enc.encode(part));c.close()}}),{headers:{'content-type':'text/event-stream'}})}})
 try{
  const provider=createProvider({liveEnabled:true,endpoint:`http://127.0.0.1:${server.port}`,model:'test-model',apiKey:'test-key'}),events=[]
  for await(const event of provider.stream!([{role:'user',content:'test'}],10,{tools:[{type:'function'}]}))events.push(event)
  expect(sent.stream_options).toEqual({include_usage:true});expect(sent.tools).toHaveLength(1);expect(events).toHaveLength(2);expect(events[1]?.usage).toEqual({inputTokens:3,outputTokens:2})
 }finally{server.stop()}
})
