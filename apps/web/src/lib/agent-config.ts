import type { ServerConfig } from '../components/Session'

export function agentSnippets(API: string, config: ServerConfig) {
  const model = config.model
  const modelLimits = { context: config.contextTokens, output: config.maxOutputTokens }
  const agentReady = config.capabilities?.streaming === true && config.capabilities.toolCalls === true
  return model ? {
    opencode: agentReady ? JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      provider: { promptplay: {
        npm: '@ai-sdk/openai-compatible', name: 'PromptPlay',
        options: { baseURL: `${API}/v1`, apiKey: '{env:PROMPTPLAY_API_KEY}' },
        models: { [model]: { name: model, limit: modelLimits, tool_call: config.capabilities?.toolCalls === true } }
      } }
    }, null, 2) : null,
    pi: agentReady ? JSON.stringify({ providers: { promptplay: {
      baseUrl: `${API}/v1`, api: 'openai-completions', apiKey: 'PROMPTPLAY_API_KEY',
      models: [{ id: model, name: model, reasoning: false, input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: config.contextTokens, maxTokens: config.maxOutputTokens }]
    } } }, null, 2) : null,
    curl: `curl ${API}/v1/chat/completions \\\n  -H "Authorization: Bearer $PROMPTPLAY_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ model, messages: [{ role: 'user', content: 'Hello PromptPlay' }], max_tokens: Math.min(128, config.maxOutputTokens ?? 128) })}'`
  } : null
}
