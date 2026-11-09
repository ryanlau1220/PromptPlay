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
import { TOKEN } from '../lib/game'
import { API, useSession } from './Session'
import { agentSnippets } from '../lib/agent-config'

type Intent = {
  id:string
  account_id:string
  deposit:{account:string;amount:string;units:string;expires:string;approved:boolean;status:'Pending'|'Consumed'|'Refunding'}|null
  reservation:'held'|'credited'|'refunded'|null
  rejected:boolean
}

type KeyItem = {
  id: string
  quota: number
  revoked: number
}

export function Redemption() {
  const { signedAccountId: account, callFunctionRaw } = useNearWallet()
  const { config, refreshConfig, token: session, login, request } = useSession()

  const [balance, setBalance] = useState<number | null>(null)
  const [intent, setIntent] = useState<Intent | null>(null)
  const [depositHash, setDepositHash] = useState('')
  const [recoveryId, setRecoveryId] = useState('')
  const [intentHistory, setIntentHistory] = useState<Array<{id:string}>>([])
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
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [prompt, setPrompt] = useState('Explain how NEAR smart contracts handle async callbacks safely in 2 bullet points.')
  const [answer, setAnswer] = useState('')

  const slot = `promptplay:redemption:${account}`
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),1000);return ()=>window.clearInterval(timer)},[])

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
    const list=await request<{intents:Array<{id:string;rejected:number}>}>('/api/redemptions','GET',undefined,token)
    setIntentHistory(list.intents)
    const data=saved ? JSON.parse(saved) as {id:string;submitted?:boolean;hash?:string} : null
    const id=data?.id ?? list.intents.find(item=>!item.rejected)?.id
    if(id){
      const state=await request<{deposit:Intent['deposit'];reservation:Intent['reservation'];rejected:boolean}>(`/api/redemptions/${encodeURIComponent(id)}`,'GET',undefined,token)
      if((state.reservation==='refunded' || state.rejected) && !state.deposit){localStorage.removeItem(slot);setIntent(null);setSubmitted(false);setDepositHash('');await refreshConfig();return}
      setIntent({id,account_id:account,...state})
      setDepositHash(data?.hash??'')
      setSubmitted(data?.submitted === true || state.deposit!==null)
      if(!saved)localStorage.setItem(slot,JSON.stringify({id,submitted:state.deposit!==null}))
    }

  }, [session, request, slot, refreshConfig, account])

  useEffect(() => {
    setIntent(previous => previous?.account_id === account ? previous : null)
    setSubmitted(false)
    setDepositHash('')
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
    const created = await request<{id:string}>('/api/redemptions', 'POST', {})
    localStorage.setItem(slot, JSON.stringify({ id: created.id }))
    await refresh()
  }

  async function transfer() {
    if (!intent || intent.deposit || submitted || !config?.escrowAccount) return
    localStorage.setItem(slot, JSON.stringify({ id:intent.id, submitted:true }))
    setSubmitted(true)
    const result=await callFunctionRaw({contractId:TOKEN,method:'ft_transfer_call',args:{receiver_id:config.escrowAccount,amount:'5000000',memo:null,msg:intent.id},gas:'100000000000000',deposit:'1'})
    if(result.transaction?.hash){setDepositHash(result.transaction.hash);localStorage.setItem(slot,JSON.stringify({id:intent.id,submitted:true,hash:result.transaction.hash}))}
    await refresh()
    setMessage('Deposit submitted. Refresh until it appears on-chain.')
  }

  async function approveAndConsume() {
    if (!intent || !config?.escrowAccount) return
    await request(`/api/redemptions/${encodeURIComponent(intent.id)}/approve`, 'POST')
    await callFunctionRaw({contractId:config.escrowAccount,method:'consume',args:{id:intent.id},gas:'30000000000000',deposit:'0'})
    await claim()
  }

  async function claim() {
    if (!intent) return
    await request(`/api/redemptions/${encodeURIComponent(intent.id)}/claim`, 'POST')
    await refresh(); await refreshConfig()
    window.dispatchEvent(new Event('promptplay:balance'))
    setMessage('Gateway units credited.')
  }

  async function refund() {
    if (!intent || !config?.escrowAccount) return
    await callFunctionRaw({contractId:config.escrowAccount,method:'refund',args:{id:intent.id},gas:'70000000000000',deposit:'1'})
    const state=await request<{deposit:Intent['deposit']}>(`/api/redemptions/${encodeURIComponent(intent.id)}`,'GET')
    if(state.deposit){await refresh();setMessage('Refund is not finalized. Refresh and try again if needed.');return}
    if(intent.reservation==='held')await request(`/api/redemptions/${encodeURIComponent(intent.id)}/refund`, 'POST')
    localStorage.removeItem(slot);setIntent(null);setSubmitted(false)
    await refreshConfig()
    setMessage('Refund submitted. Check your PCC balance.')
  }

  async function reconcileRejection() {
    if(!intent || !depositHash)return
    await request(`/api/redemptions/${encodeURIComponent(intent.id)}/rejected`, 'POST', {transactionHash:depositHash})
    localStorage.removeItem(slot);setIntent(null);setSubmitted(false);setDepositHash('')
    await refreshConfig();setMessage('Unaccepted deposit confirmed. You can start again.')
  }

  async function createKey() {
    if(!balance)throw new Error('No gateway allowance remains.')
    const result = await request<{key:string}>('/api/keys', 'POST', { quota: Math.min(balance,1_000_000_000) })
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
          {balance === null && <span className="hint">Sign challenge to inspect</span>}
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
              {!intent && config.escrowAccount && <details><summary>Recover a deposit</summary>{intentHistory.slice(0,5).map(item=><button key={item.id} type="button" className="btn-ghost" disabled={busy} onClick={()=>void action(async()=>{localStorage.setItem(slot,JSON.stringify({id:item.id,submitted:true}));await refresh()})}>{item.id.slice(0,12)}…</button>)}<input className="input-field" value={recoveryId} onChange={e=>setRecoveryId(e.target.value.trim())} placeholder="Deposit ID" /><button type="button" className="btn-ghost" disabled={busy || !/^[A-Za-z0-9_-]{32,64}$/.test(recoveryId)} onClick={()=>void action(async()=>{localStorage.setItem(slot,JSON.stringify({id:recoveryId,submitted:true}));await refresh()})}>Open deposit</button></details>}

              {intent && intent.reservation !== 'credited' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>5 PCC · {intent.id.slice(0, 12)}…</div>
                  {!intent.deposit && !submitted && <button type="button" className="btn-primary" disabled={busy || !config.redemptionAvailable} onClick={() => void action(transfer)}>Deposit PCC</button>}
                  {!intent.deposit && submitted && <p>Check wallet history and refresh before attempting another deposit.</p>}
                  {!intent.deposit && submitted && <><input className="input-field" value={depositHash} onChange={e=>setDepositHash(e.target.value.trim())} placeholder="Deposit transaction hash" /><button type="button" className="btn-ghost" disabled={busy || !depositHash} onClick={()=>void action(reconcileRejection)}>Confirm returned deposit</button></>}
                  {!intent.deposit && submitted && <button type="button" className="btn-ghost" disabled={busy} onClick={()=>{localStorage.removeItem(slot);setIntent(null);setSubmitted(false);setDepositHash('');setMessage('Any submitted transaction can still be recovered by its deposit ID.')}}>Start another</button>}
                  {(intent.rejected || intent.reservation === 'refunded') && intent.deposit && <p>This deposit ID is closed. Refund after expiry.</p>}
                  {intent.deposit?.status === 'Pending' && !intent.rejected && intent.reservation !== 'refunded' && !intent.deposit.approved && <button type="button" className="btn-primary" disabled={busy || !config.redemptionAvailable} onClick={() => void action(approveAndConsume)}>Authorize and consume</button>}
                  {intent.deposit?.status === 'Pending' && !(intent.rejected || intent.reservation === 'refunded') && intent.deposit.approved && <button type="button" className="btn-primary" disabled={busy || !config.redemptionAvailable} onClick={() => void action(approveAndConsume)}>Consume deposit</button>}
                  {intent.deposit?.status === 'Consumed' && <button type="button" className="btn-primary" disabled={busy} onClick={() => void action(claim)}>Claim gateway units</button>}
                  {intent.deposit?.status === 'Pending' && <button type="button" className="btn-ghost" disabled={busy || BigInt(intent.deposit.expires) > BigInt(now) * 1000000n} onClick={() => void action(refund)}>Refund after expiry</button>}
                  {!intent.deposit && intent.reservation === 'held' && <button type="button" className="btn-ghost" disabled={busy} onClick={() => void action(async()=>{await request(`/api/redemptions/${encodeURIComponent(intent.id)}/refund`, 'POST');localStorage.removeItem(slot);setIntent(null);setSubmitted(false);await refreshConfig()})}>Reconcile refund</button>}
                  <button type="button" className="btn-ghost" disabled={busy} onClick={() => void action(async()=>{await refresh();await refreshConfig()})}>Refresh status</button>
                </div>
              )}
              {intent?.reservation === 'credited' && <button type="button" className="btn-ghost" onClick={()=>{localStorage.removeItem(slot);setIntent(null);setSubmitted(false)}}>Create another redemption</button>}
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
