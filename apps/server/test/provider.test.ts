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
