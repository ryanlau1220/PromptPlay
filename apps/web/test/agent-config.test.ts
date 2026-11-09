import { describe, expect, test } from 'bun:test'
import { agentSnippets } from '../src/lib/agent-config'

const config = { redemptionAvailable: true, redemptionUnitsAvailable:1, faucetAvailable: false, provider: 'Example', model: 'example/model', capabilities:{streaming:true,toolCalls:true}, contextTokens: 8192, maxOutputTokens: 256, microsPerUnit: 1000000, pccPerUnit: '5' }

describe('agent configuration', () => {
  test('uses the gateway model and limits with an environment-based key', () => {
    const snippets = agentSnippets('http://localhost:3001', config)
    if (!snippets?.opencode || !snippets.pi) throw new Error('Expected agent configurations')
    const opencode = JSON.parse(snippets.opencode)
    const pi = JSON.parse(snippets.pi)
    expect(opencode.provider.promptplay.models['example/model'].limit).toEqual({ context: 8192, output: 256 })
    expect(opencode.provider.promptplay.options.apiKey).toBe('{env:PROMPTPLAY_API_KEY}')
    expect(pi.providers.promptplay.models[0]).toMatchObject({ id: 'example/model', contextWindow: 8192, maxTokens: 256 })
    expect(pi.providers.promptplay.apiKey).toBe('PROMPTPLAY_API_KEY')
    expect(snippets.curl).toContain('example/model')
    expect(snippets.codex).toContain('wire_api = "responses"')
    expect(snippets.codex).toContain('env_key = "PROMPTPLAY_API_KEY"')
    expect(snippets.codex).toContain('model_reasoning_effort = "none"')
  })
  test('does not offer a configuration when the gateway is unavailable', () => {
    expect(agentSnippets('http://localhost:3001', { ...config, model: null })).toBeNull()
  })
  test('only offers coding-agent configs when streaming and tool calling are verified', () => {
    for (const capabilities of [{streaming:false,toolCalls:true},{streaming:true,toolCalls:false}]) {
      const snippets=agentSnippets('http://localhost:3001',{...config,capabilities})
      if (!snippets) throw new Error('Expected gateway configuration')
      expect(snippets.opencode).toBeNull();expect(snippets.pi).toBeNull();expect(snippets.codex).toBeNull();expect(snippets.curl).toContain('example/model')
    }
  })
})
