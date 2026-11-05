import { expect, test } from "bun:test";
import { createProvider, mockProvider } from "../src/provider";
test("live provider is disabled by default", () => {
  expect(() => createProvider({liveEnabled:false, endpoint:"https://cloud-api.near.ai/v1", model:"zai-org/GLM-5.1-FP8", apiKey:""})).toThrow("disabled");
});
test("mock is deterministic and explicitly labeled", async () => {
  expect(await mockProvider().complete([{role:"user", content:"hello"}], 10)).toEqual({text:"Mock response", inputTokens:2, outputTokens:2});
});
