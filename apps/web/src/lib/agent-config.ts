import type { ServerConfig } from '../components/Session'

export function agentSnippets(apiUrl: string, config: ServerConfig) {
  const API = apiUrl.replace(/\/+$/, '')
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
    codex: agentReady ? `model = ${JSON.stringify(model)}\nmodel_provider = "promptplay"\nmodel_reasoning_effort = "none"\nweb_search = "disabled"\n\n[features]\napps = false\nplugins = false\nmulti_agent = false\nunified_exec = false\ncode_mode_host = false\n\n[model_providers.promptplay]\nname = "PromptPlay"\nbase_url = ${JSON.stringify(`${API}/v1`)}\nenv_key = "PROMPTPLAY_API_KEY"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\nstream_max_retries = 0\nrequest_max_retries = 0` : null,
    curl: `curl ${API}/v1/chat/completions \\\n  -H "Authorization: Bearer $PROMPTPLAY_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ model, messages: [{ role: 'user', content: 'Hello PromptPlay' }], max_tokens: Math.min(128, config.maxOutputTokens ?? 128) })}'`
  } : null
}
