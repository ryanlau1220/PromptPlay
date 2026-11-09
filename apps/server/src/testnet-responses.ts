import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from 'near-api-js'
import { signMessage } from 'near-api-js/nep413'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
const api = process.env.JOURNEY_API_URL || 'http://127.0.0.1:3001',
  account = process.env.TESTNET_PLAYER_A,
  path = process.env.TESTNET_PLAYER_A_KEY
if (!account?.endsWith('.testnet') || !path) throw new Error('Set TESTNET_PLAYER_A and TESTNET_PLAYER_A_KEY')
if (!['127.0.0.1', 'localhost'].includes(new URL(api).hostname)) throw new Error('Use a local operator gateway')
const cred = await Bun.file(path).json(),
  pair = KeyPair.fromString(cred.private_key),
  rpc = new JsonRpcProvider({ url: 'https://archival-rpc.testnet.near.org' }),
  signer = new Account(account, rpc, new KeyPairSigner(pair))
if ((await rpc.getNetworkId()) !== 'testnet') throw new Error('RPC is not Testnet')
async function request(endpoint: string, method = 'GET', body?: unknown, token?: string) {
  const r = await fetch(api + endpoint, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  })
  if (!r.ok) throw new Error(`${endpoint} returned HTTP ${r.status}`)
  return r
}
const trace: Record<string, unknown> = {
  account,
  status: 'starting',
  scope: 'local operator gateway and real configured provider',
}
await mkdir('tmp', { recursive: true })
const tracePath = `tmp/testnet-responses-${randomUUID()}.json`,
  save = () => writeFile(tracePath, JSON.stringify(trace, null, 2), { mode: 0o600 })
await save()
let session = '',
  keyId = ''
try {
  const config = (await (await request('/config')).json()) as {
    model: string
    provider: string
    capabilities?: { streaming: boolean; toolCalls: boolean }
    maxOutputTokens: number
  }
  if (!config.capabilities?.streaming || !config.capabilities.toolCalls)
    throw new Error('Streaming and tool calling are required')
  const c = (await (await request('/api/auth/challenge', 'POST')).json()) as {
    id: string
    message: string
    recipient: string
    nonce: string
  }
  const signed = await signMessage({
    signerAccount: signer,
    payload: { message: c.message, recipient: c.recipient, nonce: Uint8Array.from(Buffer.from(c.nonce, 'base64')) },
  })
  session = (
    (await (
      await request('/api/auth/verify', 'POST', {
        challengeId: c.id,
        accountId: account,
        publicKey: pair.getPublicKey().toString(),
        signature: Buffer.from(signed.signature).toString('base64'),
      })
    ).json()) as { token: string }
  ).token
  const before = (
    (await (await request('/api/inference/balance', 'GET', undefined, session)).json()) as { units: number }
  ).units
  const key = (await (await request('/api/keys', 'POST', { quota: 1000000 }, session)).json()) as {
    id: string
    key: string
  }
  keyId = key.id
  trace.provider = config.provider
  trace.model = config.model
  trace.allowanceBefore = before
  trace.status = 'requesting'
  await save()
  const response = await request(
    '/v1/responses',
    'POST',
    {
      model: config.model,
      input: 'Call lookup with query "promptplay".',
      max_output_tokens: Math.min(128, config.maxOutputTokens),
      stream: true,
      store: false,
      tool_choice: 'required',
      tools: [
        {
          type: 'function',
          name: 'lookup',
          description: 'Look up a query',
          parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
          strict: false,
        },
      ],
    },
    key.key,
  )
  const frames = (await response.text())
    .trim()
    .split('\n\n')
    .map((frame) => {
      const data = frame.split('\n').find((line) => line.startsWith('data: '))
      return data
        ? (JSON.parse(data.slice(6)) as {
            type: string
            response?: { output?: Array<{ type: string; name?: string; call_id?: string }>; usage?: unknown }
          })
        : null
    })
    .filter(Boolean)
  const final = frames.find((frame) => frame?.type === 'response.completed')?.response
  if (!final?.output?.some((item) => item.type === 'function_call' && item.name === 'lookup' && item.call_id))
    throw new Error('Provider did not return the required tool call')
  const after = (
    (await (await request('/api/inference/balance', 'GET', undefined, session)).json()) as { units: number }
  ).units
  if (after >= before) throw new Error('Metered allowance did not decrease')
  trace.allowanceAfter = after
  trace.usage = final.usage
  trace.toolCall = 'lookup'
  trace.status = 'passed'
  await save()
  if (process.env.RESPONSES_TEST_CODEX === 'true') {
    const codexPath = Bun.which('codex')
    if (!codexPath || !Bun.which('bwrap'))
      throw new Error('Codex CLI and bubblewrap are required for the isolated test')
    const userHome = process.env.HOME
    if (!userHome || !isAbsolute(userHome) || userHome === '/')
      throw new Error('An absolute user home is required for the isolated test')
    const directory = await mkdtemp(join(tmpdir(), 'promptplay-codex-'))
    await writeFile(join(directory, 'marker.txt'), 'PROMPTPLAY_CODEX_FILE_OK\n')
    const shapes: Array<{
      fields: string[]
      toolTypes: string[]
      inputTypes: string[]
      toolNames: unknown[]
      reasoning: unknown
      include: unknown
    }> = []
    const proxy = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        const body = await req.text()
        const parsed = (body ? JSON.parse(body) : {}) as {
          input?: Array<{ type?: string }>
          tools?: Array<{ type?: string; name?: string; tools?: Array<{ name?: string; type?: string }> }>
          reasoning?: unknown
          include?: unknown
        }
        shapes.push({
          fields: Object.keys(parsed),
          toolTypes: [...new Set((parsed.tools ?? []).map((t) => t.type ?? 'unknown'))],
          inputTypes: [...new Set((Array.isArray(parsed.input) ? parsed.input : []).map((i) => i.type ?? 'message'))],
          toolNames: (parsed.tools ?? []).map((t) => ({
            type: t.type,
            name: t.name,
            members: t.tools?.map((m) => ({ type: m.type, name: m.name })),
          })),
          reasoning: parsed.reasoning,
          include: parsed.include,
        })
        trace.codexRequests = shapes
        await save()
        return fetch(`${api}${new URL(req.url).pathname}`, {
          method: req.method,
          headers: { 'content-type': 'application/json', authorization: req.headers.get('authorization') ?? '' },
          ...(body ? { body } : {}),
        })
      },
    })
    try {
      const args = [
        'bwrap',
        '--die-with-parent',
        '--unshare-all',
        '--share-net',
        '--ro-bind',
        '/usr',
        '/usr',
        '--ro-bind',
        '/lib',
        '/lib',
        '--ro-bind',
        '/lib64',
        '/lib64',
        '--ro-bind',
        '/bin',
        '/bin',
        '--ro-bind',
        '/etc/passwd',
        '/etc/passwd',
        '--ro-bind',
        '/etc/group',
        '/etc/group',
        '--ro-bind',
        '/etc/nsswitch.conf',
        '/etc/nsswitch.conf',
        '--ro-bind',
        '/etc/ssl/certs',
        '/etc/ssl/certs',
        '--proc',
        '/proc',
        '--dev',
        '/dev',
        '--tmpfs',
        '/tmp',
        '--dir',
        dirname(userHome),
        '--tmpfs',
        userHome,
        '--bind',
        directory,
        '/work',
        '--ro-bind',
        await realpath(codexPath),
        '/codex',
        '--chdir',
        '/work',
        '/codex',
        'exec',
        '--ignore-user-config',
        '--ephemeral',
        '--skip-git-repo-check',
        '--json',
        '--sandbox',
        'read-only',
        '--disable',
        'multi_agent',
        '--disable',
        'unified_exec',
        '--disable',
        'code_mode_host',
        '--disable',
        'apps',
        '--disable',
        'plugins',
        '-C',
        '/work',
        '-m',
        config.model,
        '-c',
        'web_search="disabled"',
        '-c',
        'model_reasoning_effort="none"',
        '-c',
        'model_provider="promptplay"',
        '-c',
        'model_providers.promptplay.name="PromptPlay"',
        '-c',
        `model_providers.promptplay.base_url="http://127.0.0.1:${proxy.port}/v1"`,
        '-c',
        'model_providers.promptplay.env_key="PROMPTPLAY_API_KEY"',
        '-c',
        'model_providers.promptplay.wire_api="responses"',
        '-c',
        'model_providers.promptplay.requires_openai_auth=false',
        '-c',
        'model_providers.promptplay.supports_websockets=false',
        '-c',
        'model_providers.promptplay.stream_max_retries=0',
        '-c',
        'model_providers.promptplay.request_max_retries=0',
        'Read marker.txt with a file or shell tool, then reply with its exact contents.',
      ]
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => ['PATH', 'LANG', 'HOME', 'TERM'].includes(name)),
      )
      const child = Bun.spawn(args, {
        cwd: directory,
        env: { ...env, PROMPTPLAY_API_KEY: key.key },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const timer = setTimeout(() => child.kill(), 120000)
      const [output, errors, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      clearTimeout(timer)
      trace.codexExit = exit
      trace.codexOutputContainsMarker = output.includes('PROMPTPLAY_CODEX_FILE_OK')
      trace.codexError = errors.replaceAll(key.key, '[redacted]').slice(-1000)
      await save()
      if (
        exit !== 0 ||
        !output.includes('PROMPTPLAY_CODEX_FILE_OK') ||
        !/command_execution|tool_use|tool-call/i.test(output)
      )
        throw new Error('Codex file-read check did not pass')
      const codexBalance = (
        (await (await request('/api/inference/balance', 'GET', undefined, session)).json()) as { units: number }
      ).units
      if (codexBalance >= after) throw new Error('Codex usage did not settle against the allowance')
      trace.allowanceAfterCodex = codexBalance
      trace.codexFileRead = true
      await save()
    } finally {
      proxy.stop(true)
      await rm(directory, { recursive: true, force: true })
    }
  }
  console.log(`Responses live tool stream passed. Trace: ${tracePath}`)
} catch (error) {
  trace.status = 'needs-reconciliation'
  trace.error = error instanceof Error ? error.message : 'Unknown error'
  await save()
  console.error(`Inspect ${tracePath} before retrying.`)
  throw error
} finally {
  if (keyId && session) await request(`/api/keys/${keyId}`, 'DELETE', undefined, session).catch(() => {})
  if (session) await request('/api/auth/session', 'DELETE', undefined, session).catch(() => {})
}
