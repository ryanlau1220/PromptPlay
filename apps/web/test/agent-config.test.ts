import { describe, expect, test } from 'bun:test'
import { agentSnippets } from '../src/lib/agent-config'

const config = { redemptionAvailable: true, faucetAvailable: false, model: 'example/model', contextTokens: 8192, maxOutputTokens: 256, microsPerUnit: 1000000, pccPerUnit: '5' }

describe('agent configuration', () => {
  test('uses the gateway model and limits with an environment-based key', () => {
    const snippets = agentSnippets('http://localhost:3001', config)!
    const opencode = JSON.parse(snippets.opencode)
    const pi = JSON.parse(snippets.pi)
    expect(opencode.provider.promptplay.models['example/model'].limit).toEqual({ context: 8192, output: 256 })
    expect(opencode.provider.promptplay.options.apiKey).toBe('{env:PROMPTPLAY_API_KEY}')
    expect(pi.providers.promptplay.models[0]).toMatchObject({ id: 'example/model', contextWindow: 8192, maxTokens: 256 })
    expect(pi.providers.promptplay.apiKey).toBe('PROMPTPLAY_API_KEY')
    expect(snippets.curl).toContain('example/model')
  })
  test('does not offer a configuration when the gateway is unavailable', () => {
    expect(agentSnippets('http://localhost:3001', { ...config, model: null })).toBeNull()
  })
})
