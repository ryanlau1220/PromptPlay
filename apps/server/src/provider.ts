export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type Completion = { text: string; inputTokens: number; outputTokens: number; finishReason: string };
export interface InferenceProvider { complete(messages: ChatMessage[], maxTokens: number): Promise<Completion>; }

export function providerConfig(env: Record<string, string | undefined>) {
  return {
    liveEnabled: env.PROMPTPLAY_LIVE_INFERENCE === "true",
    endpoint: env.INFERENCE_BASE_URL ?? "https://cloud-api.near.ai/v1",
    model: env.INFERENCE_MODEL ?? "zai-org/GLM-5.1-FP8",
    apiKey: env.INFERENCE_API_KEY ?? "",
  };
}

/** Live requests are disabled unless the operator explicitly enables an authorized deployment. */
export function createProvider(config: { liveEnabled: boolean; endpoint: string; model: string; apiKey: string }): InferenceProvider {
  if (!config.liveEnabled) throw new Error("Live inference is disabled");
  const base = new URL(config.endpoint);
  if (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1") throw new Error("Provider must use HTTPS or localhost");
  if (!config.apiKey || !config.model) throw new Error("Provider credentials and model are required");
  return {
    async complete(messages, maxTokens) {
      const res = await fetch(`${config.endpoint.replace(/\/$/, "")}/chat/completions`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({model: config.model, messages, max_tokens: maxTokens, stream: false}),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Provider returned HTTP ${res.status}`);
      const data = await res.json() as {choices?: Array<{message?: {content?: unknown}; finish_reason?: unknown}>; usage?: {prompt_tokens?: unknown; completion_tokens?: unknown}};
      const text = data.choices?.[0]?.message?.content;
      const finishReason = data.choices?.[0]?.finish_reason;
      const inputTokens = data.usage?.prompt_tokens;
      const outputTokens = data.usage?.completion_tokens;
      if (typeof text !== "string" || typeof finishReason !== "string" || !Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens) || (inputTokens as number) < 0 || (outputTokens as number) < 0) throw new Error("Provider response lacks valid text or usage");
      return {text, inputTokens: inputTokens as number, outputTokens: outputTokens as number, finishReason};
    },
  };
}

/** Deterministic offline test double; never exposed as a real inference provider. */
export function mockProvider(): InferenceProvider {
  return { async complete() { return {text: "Mock response", inputTokens: 2, outputTokens: 2, finishReason: "stop"}; } };
}
