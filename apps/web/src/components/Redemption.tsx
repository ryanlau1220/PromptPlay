import { useNearWallet } from 'near-connect-hooks'
import { useCallback, useEffect, useState } from 'react'
import {
  Coins,
  Key,
  Terminal,
  Send,
  Copy,
  Check,
  ShieldCheck,
  AlertCircle,
  Code2,
  Trash2,
  Lock,
  ArrowRight
} from 'lucide-react'
import { pcc, TOKEN } from '../lib/game'
import { API, useSession } from './Session'
import { agentSnippets } from '../lib/agent-config'

const TREASURY = 'treasury.ryanlau1220.testnet'

type Intent = {
  id: string
  account_id: string
  amount: string
  units: number
  memo: string
  expires: number
  receipt_id: string | null
  tx_hash: string | null
  attempted: number
  failed: number
}

type KeyItem = {
  id: string
  quota: number
  revoked: number
}

export function Redemption() {
  const { signedAccountId: account, callFunctionRaw } = useNearWallet()
  const { config, token: session, login, request } = useSession()

  const [balance, setBalance] = useState<number | null>(null)
  const [intent, setIntent] = useState<Intent | null>(null)
  const [hash, setHash] = useState('')
  const [keys, setKeys] = useState<KeyItem[]>([])
  const [newKey, setNewKey] = useState('')
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedSnippet, setCopiedSnippet] = useState(false)
  const [activeSnippetTab, setActiveSnippetTab] = useState<'opencode' | 'pi' | 'codex' | 'curl'>('opencode')

  const [usage, setUsage] = useState<
    Array<{
      id: string
      charged: number | null
      state: string
      input_tokens: number | null
      output_tokens: number | null
    }>
  >([])

  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [prompt, setPrompt] = useState('Explain how NEAR smart contracts handle async callbacks safely in 2 bullet points.')
  const [answer, setAnswer] = useState('')

  const slot = `promptplay:redemption:${account}`

  const refresh = useCallback(async (token = session) => {
    const [b, k, u] = await Promise.all([
      request<{units:number}>('/api/inference/balance', 'GET', undefined, token),
      request<{keys:KeyItem[]}>('/api/keys', 'GET', undefined, token),
      request<{requests:typeof usage}>('/api/inference/usage', 'GET', undefined, token)
    ])
    setBalance(b.units)
    setKeys(k.keys)
    setUsage(u.requests)

    const saved = localStorage.getItem(slot)
    if (saved) {
      const data = JSON.parse(saved) as { id: string; hash?: string; submitted?: boolean }
      const i = await request<Intent>(`/api/redemptions/${encodeURIComponent(data.id)}`, 'GET', undefined, token)
      if (i.failed || (!i.attempted && !i.receipt_id && i.expires <= Date.now())) {
        localStorage.removeItem(slot)
        setIntent(null)
        setSubmitted(false)
        setHash('')
        return
      }
      setIntent(i)
      setSubmitted(data.submitted === true || !!data.hash || !!i.attempted)
      setHash(data.hash ?? i.tx_hash ?? '')
    } else {
      const result = (await request('/api/redemptions', 'GET', undefined, token)) as { intents: Intent[] }
      const pending = result.intents.find((i) => !i.receipt_id && !i.failed && (!!i.attempted || i.expires > Date.now()))
      if (pending) {
        setIntent(pending)
        setSubmitted(!!pending.attempted)
        setHash(pending.tx_hash ?? '')
        localStorage.setItem(slot, JSON.stringify({ id: pending.id }))
      }
    }
  }, [session, request, slot])

  useEffect(() => {
    setIntent(previous => previous?.account_id === account ? previous : null)
    setHash('')
    setSubmitted(false)
    setNewKey('')
    setBalance(null)
  }, [account])

  useEffect(() => {
    if (session) void refresh(session).catch(() => setMessage('Could not load your inference account.'))
  }, [session, refresh])

  async function action(fn: () => Promise<void>) {
    setBusy(true)
    setMessage('')
    try {
      await fn()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Request failed.')
    } finally {
      setBusy(false)
    }
  }

  async function createIntent() {
    const created = await request<{id:string}>('/api/redemptions', 'POST', { units: 1 })
    localStorage.setItem(slot, JSON.stringify({ id: created.id }))
    await refresh()
  }

  async function transfer() {
    if (!intent || intent.receipt_id || submitted) return
    const current = (await request(`/api/redemptions/${encodeURIComponent(intent.id)}`)) as Intent
    if (current.account_id !== account || current.receipt_id) throw new Error('This intent is no longer available.')
    if (current.expires - Date.now() < 60_000) throw new Error('Payment window is too close to expiry.')

    await request(`/api/redemptions/${encodeURIComponent(current.id)}/attempt`, 'POST')
    localStorage.setItem(slot, JSON.stringify({ id: current.id, submitted: true }))
    setSubmitted(true)

    const result = await callFunctionRaw({
      contractId: TOKEN,
      method: 'ft_transfer',
      args: { receiver_id: TREASURY, amount: current.amount, memo: current.memo },
      gas: '30000000000000',
      deposit: '1'
    })
    const transactionHash = result.transaction?.hash
    if (!transactionHash) {
      throw new Error('Payment was submitted. Check wallet history for transaction hash and paste below.')
    }
    localStorage.setItem(slot, JSON.stringify({ id: current.id, hash: transactionHash, submitted: true }))
    setHash(transactionHash)

    await request(`/api/redemptions/${encodeURIComponent(current.id)}/verify`, 'POST', { transactionHash })
    await refresh()
    window.dispatchEvent(new Event('promptplay:balance'))
    setMessage('Transfer verified on NEAR! Gateway units credited.')
  }

  async function verify() {
    if (!intent) return
    localStorage.setItem(slot, JSON.stringify({ id: intent.id, hash, submitted: true }))
    await request(`/api/redemptions/${encodeURIComponent(intent.id)}/verify`, 'POST', { transactionHash: hash })
    await refresh()
    window.dispatchEvent(new Event('promptplay:balance'))
    setMessage('Transfer verified on NEAR! Gateway units credited.')
  }

  async function reconcileFailure() {
    if (!intent) return
    await request(`/api/redemptions/${encodeURIComponent(intent.id)}/failure`, 'POST', { transactionHash: hash })
    localStorage.removeItem(slot)
    setIntent(null)
    setSubmitted(false)
    setHash('')
    await refresh()
    setMessage('Failed transfer confirmed. You can create a new intent.')
  }

  async function createKey() {
    const result = await request<{key:string}>('/api/keys', 'POST', { quota: 1_000_000 })
    setNewKey(result.key)
    await refresh()
  }

  async function ask() {
    if (!newKey || !prompt.trim()) throw new Error('Create an API key and enter a test prompt.')
    const models = (await request('/v1/models', 'GET', undefined, newKey)) as { data: Array<{ id: string }> }
    const model = models.data[0]?.id
    if (!model) throw new Error('No gateway model is currently configured.')

    const response = await request<{choices:Array<{message:{content:string}}> }>(
      '/v1/chat/completions',
      'POST',
      {
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: Math.min(128, config?.maxOutputTokens ?? 128)
      },
      newKey
    )

    setAnswer(response.choices[0].message.content)
    await refresh()
  }

  function copyKeyToClipboard() {
    if (!newKey) return
    void navigator.clipboard.writeText(newKey).then(() => {
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
    })
  }

  const snippetContent = config ? agentSnippets(API, config) : null

  return (
    <div className="redemption-container">
      {/* TELEMETRY HUD */}
      <div className="hud-telemetry-grid">
        <div className="telemetry-card highlight-cyan">
          <span className="label">ACTIVE INFERENCE ALLOWANCE</span>
          <span className="value">
            {balance === null ? '—' : (balance / 1_000_000).toFixed(4)}{' '}
            <small style={{ fontSize: '14px', color: 'var(--text-muted)' }}>UNITS</small>
          </span>
          <span className="hint">
            {balance === null ? 'Sign challenge to inspect' : config?.microsPerUnit
              ? `Funded capacity: $${(config.microsPerUnit / 1_000_000 * (balance / 1_000_000)).toFixed(4)} USD`
              : 'Funding terms unavailable'}
          </span>
        </div>

        <div className="telemetry-card highlight-amber">
          <span className="label">CONVERSION RATE</span>
          <span className="value">5 PCC : 1 UNIT</span>
          <span className="hint">1,000,000 µ-units</span>
        </div>

        <div className="telemetry-card">
          <span className="label">GATEWAY STATUS</span>
          <span className="value" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: config?.redemptionAvailable ? 'var(--emerald)' : 'var(--amber)'
              }}
            />
            <span style={{ fontSize: '20px' }}>
              {!config ? 'CONNECTING' : config.redemptionAvailable ? 'ENABLED' : 'DISABLED'}
            </span>
          </span>
          <span className="hint">
            {!config ? 'Checking gateway' : config.redemptionAvailable ? `${config.provider} · ${config.model}` : 'Live redemption unavailable'}
          </span>
          {config?.redemptionAvailable && <span className="hint">Chat completions{config.capabilities?.streaming ? ' · Streaming' : ''}{config.capabilities?.toolCalls ? ' · Tool calls' : ''}</span>}
        </div>
      </div>

      {!config ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <p>Connecting to Gateway...</p>
        </div>
      ) : !session ? (
        <div className="terminal-card" style={{ maxWidth: '540px', margin: '40px auto', textAlign: 'center' }}>
          <Lock size={36} color="var(--cyan)" style={{ margin: '0 auto 12px' }} />
          <h3 style={{ justifyContent: 'center', marginBottom: '20px' }}>Gateway Terminal Authentication</h3>
          <button type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const auth = await login()
                await refresh(auth)
              })
            }
          >
            <ShieldCheck size={16} />
            <span>Sign NEP-413 Challenge</span>
          </button>
        </div>
      ) : (
        <>
          <div className="redemption-pipeline-grid">
            {/* REDEEM CREDITS CARD */}
            <div className="terminal-card">
              <div className="terminal-card-header">
                <h3>
                  <Coins size={20} color="var(--amber)" />
                  <span>Redeem PCC into Compute</span>
                </h3>
                <span className="story-card-detail">5 PCC = 1 Unit</span>
              </div>

              {!config.redemptionAvailable && (
                <div
                  style={{
                    background: 'rgba(255, 184, 0, 0.1)',
                    border: '1px solid rgba(255, 184, 0, 0.3)',
                    borderRadius: '10px',
                    padding: '12px',
                    fontSize: '13px',
                    color: 'var(--amber)'
                  }}
                >
                  <AlertCircle size={15} style={{ display: 'inline', marginRight: '6px' }} />
                  Live redemption gate is currently disabled.
                </div>
              )}

              {!intent && config.redemptionAvailable && config.redemptionUnitsAvailable === 0 && <p>All demo units are currently allocated.</p>}
              {!intent && config.redemptionAvailable && config.redemptionUnitsAvailable !== 0 && (
                <div>
                  <button type="button" className="btn-primary" disabled={busy} onClick={() => void action(createIntent)}>
                    <ArrowRight size={16} />
                    <span>Create 1-Unit Intent (5 PCC)</span>
                  </button>
                </div>
              )}

              {intent && !intent.receipt_id && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ background: 'var(--surface-card)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>TRANSFER DETAILS</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--text)' }}>
                      Amount: <strong>{pcc(intent.amount)} PCC</strong>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--cyan)', marginTop: '4px' }}>
                      Memo: {intent.memo}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--amber)', marginTop: '8px' }}>
                      Expires: {new Date(intent.expires).toLocaleTimeString()}
                    </div>
                  </div>

                  <button type="button"
                    className="btn-primary"
                    disabled={busy || submitted || !!hash || !config.redemptionAvailable}
                    onClick={() => void action(transfer)}
                  >
                    <Coins size={16} />
                    <span>Submit 5 PCC Transfer in Wallet</span>
                  </button>

                  {submitted && !hash && <p>Payment attempt recorded. Check wallet history for a transaction hash; if the wallet rejected it, contact the operator before retrying.</p>}

                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
                    <label className="field-label">
                      <span>Transaction Recovery Hash</span>
                      <input
                        className="input-field"
                        value={hash}
                        onChange={(e) => setHash(e.target.value.trim())}
                        placeholder="Paste transaction hash if wallet disconnected"
                      />
                    </label>
                    <button type="button"
                      className="btn-ghost"
                      style={{ marginTop: '10px', width: '100%' }}
                      disabled={busy || !hash}
                      onClick={() => void action(verify)}
                    >
                      <ShieldCheck size={14} />
                      <span>Verify Finalized Transfer</span>
                    </button>
                    <button type="button" className="btn-ghost" disabled={busy || !hash || !submitted} onClick={() => void action(reconcileFailure)}>
                      Confirm failed transfer
                    </button>
                  </div>
                </div>
              )}

              {intent?.receipt_id && (
                <div style={{ textAlign: 'center', padding: '16px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--emerald)', borderRadius: '12px' }}>
                  <ShieldCheck size={28} color="var(--emerald)" style={{ margin: '0 auto 8px' }} />
                  <div style={{ color: 'var(--emerald)', fontWeight: 800 }}>Payment Verified & Credited</div>
                  <div style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Receipt: {intent.receipt_id.slice(0, 16)}...
                  </div>
                  <button type="button"
                    className="btn-ghost"
                    style={{ marginTop: '14px' }}
                    onClick={() => {
                      localStorage.removeItem(slot)
                      setIntent(null)
                      setHash('')
                      setSubmitted(false)
                    }}
                  >
                    <span>Create Another Redemption</span>
                  </button>
                </div>
              )}
            </div>

            {/* GATEWAY KEYS & PLAYGROUND */}
            <div className="terminal-card">
              <div className="terminal-card-header">
                <h3>
                  <Key size={20} color="var(--cyan)" />
                  <span>Gateway API Keys</span>
                </h3>
                <button type="button"
                  className="btn-primary"
                  style={{ fontSize: '12px', padding: '6px 14px' }}
                  disabled={busy || !config.redemptionAvailable}
                  onClick={() => void action(createKey)}
                >
                  <Key size={14} />
                  <span>Generate Key</span>
                </button>
              </div>

              {newKey && (
                <div className="secret-key-display">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <strong style={{ fontSize: '13px', color: 'var(--amber)' }}>
                      Copy Key Now (Shown Once)
                    </strong>
                    <button type="button" className="btn-ghost" style={{ padding: '4px 8px', fontSize: '12px' }} onClick={copyKeyToClipboard}>
                      {copiedKey ? <Check size={14} color="var(--emerald)" /> : <Copy size={14} />}
                      <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <code>{newKey}</code>
                </div>
              )}

              {/* Active Keys List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 700 }}>
                  ACTIVE KEYS ({keys.filter((k) => !k.revoked).length})
                </span>
                {keys.filter((k) => !k.revoked).map((k) => (
                  <div
                    key={k.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'var(--surface-card)',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)'
                    }}
                  >
                    <code style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--cyan)' }}>
                      key_{k.id.slice(0, 12)}...
                    </code>
                    <button type="button"
                      className="btn-disconnect"
                      disabled={busy}
                      title="Revoke key"
                      onClick={() =>
                        void action(async () => {
                          await request(`/api/keys/${encodeURIComponent(k.id)}`, 'DELETE')
                          await refresh()
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>

              {/* IN-BROWSER PROMPT PLAYGROUND */}
              {newKey && (
                <div className="playground-box">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '13px', fontWeight: 800, fontFamily: 'var(--font-display)' }}>
                      Test Prompt Terminal
                    </span>
                    <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--cyan)' }}>
                      {API}/v1
                    </span>
                  </div>

                  <textarea
                    className="input-field"
                    rows={3}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Enter test prompt for live metered completion..."
                  />

                  <button type="button"
                    className="btn-accent"
                    style={{ alignSelf: 'flex-start' }}
                    disabled={busy || !prompt.trim()}
                    onClick={() => void action(ask)}
                  >
                    <Send size={14} />
                    <span>Send Request</span>
                  </button>

                  {answer && (
                    <div className="terminal-output">
                      <div style={{ fontSize: '11px', color: 'var(--emerald)', marginBottom: '6px' }}>
                        ● 200 OK — Model Response:
                      </div>
                      <div>{answer}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* DROP-IN AGENT CONFIGURATIONS */}
          <div className="terminal-card" style={{ marginBottom: '40px' }}>
            <div className="terminal-card-header">
              <h3>
                <Code2 size={20} color="var(--cyan)" />
                <span>Coding Agent Configuration Snippets</span>
              </h3>
              <button type="button"
                className="btn-ghost"
                style={{ fontSize: '12px', padding: '6px 12px' }}
                disabled={!snippetContent?.[activeSnippetTab]}
                onClick={() => {
                  void navigator.clipboard.writeText(snippetContent?.[activeSnippetTab] ?? '').then(() => {
                    setCopiedSnippet(true)
                    setTimeout(() => setCopiedSnippet(false), 2000)
                  })
                }}
              >
                {copiedSnippet ? <Check size={14} color="var(--emerald)" /> : <Copy size={14} />}
                <span>{copiedSnippet ? 'Copied' : 'Copy Snippet'}</span>
              </button>
            </div>

            <p>Set PROMPTPLAY_API_KEY to your gateway key. The Codex settings disable web search, plugins and multi-agent features; other MCP tools may be unsupported.</p>
            <div className="code-tabs-container">
              <div className="code-tabs-header">
                <button
                  type="button"
                  className={`code-tab-btn ${activeSnippetTab === 'opencode' ? 'active' : ''}`}
                  onClick={() => setActiveSnippetTab('opencode')}
                >
                  OpenCode 1.18
                </button>
                <button
                  type="button"
                  className={`code-tab-btn ${activeSnippetTab === 'pi' ? 'active' : ''}`}
                  onClick={() => setActiveSnippetTab('pi')}
                >
                  Pi 0.73
                </button>
                <button
                  type="button"
                  className={`code-tab-btn ${activeSnippetTab === 'codex' ? 'active' : ''}`}
                  onClick={() => setActiveSnippetTab('codex')}
                >
                  Codex 0.166
                </button>
                <button
                  type="button"
                  className={`code-tab-btn ${activeSnippetTab === 'curl' ? 'active' : ''}`}
                  onClick={() => setActiveSnippetTab('curl')}
                >
                  cURL HTTP
                </button>
              </div>
              <div className="code-snippet-body">
                {snippetContent?.[activeSnippetTab] ?? (config?.model ? 'Streaming and tool calling must be verified for coding agents.' : 'Gateway model is unavailable while live inference is disabled.')}
              </div>
            </div>
          </div>

          {/* RECENT USAGE AUDIT LOG */}
          <div className="terminal-card">
            <div className="terminal-card-header">
              <h3>
                <Terminal size={20} color="var(--text-muted)" />
                <span>Inference Metering Audit Log</span>
              </h3>
              <span style={{ fontSize: '12px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                LAST {usage.length} REQUESTS
              </span>
            </div>

            {usage.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {usage.map((u) => (
                  <div
                    key={u.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'var(--surface-card)',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: u.state === 'settled' ? 'var(--emerald)' : 'var(--amber)'
                        }}
                      />
                      <span>req_{u.id.slice(0, 8)}</span>
                      <span style={{ color: 'var(--text-dim)' }}>[{u.state}]</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <span>
                        {u.input_tokens ?? 0} in / {u.output_tokens ?? 0} out
                      </span>
                      <span style={{ color: 'var(--cyan)' }}>
                        {u.charged === null ? 'reserved' : `${u.charged} µ-units`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: '13px' }}>
                No gateway requests recorded yet.
              </p>
            )}
          </div>
        </>
      )}

      {/* TOAST MESSAGE */}
      {message && (
        <output className="status-toast">
          <span>{message}</span>
        </output>
      )}
    </div>
  )
}
