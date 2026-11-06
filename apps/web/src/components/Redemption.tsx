import { useNearWallet } from 'near-connect-hooks'
import { useEffect, useState } from 'react'
import { pcc, TOKEN } from '../lib/game'
import { API, useSession } from './Session'
const TREASURY = 'treasury.ryanlau1220.testnet'
type Intent = {id:string; account_id:string; amount:string; units:number; memo:string; expires:number; receipt_id:string|null; tx_hash:string|null}
type Key = {id:string;quota:number;revoked:number}

export function Redemption() {
  const {signedAccountId:account,callFunctionRaw}=useNearWallet()
  const {config,token:session,login,request}=useSession(); const [balance,setBalance]=useState<number|null>(null)
  const [intent,setIntent]=useState<Intent|null>(null); const [hash,setHash]=useState(''); const [keys,setKeys]=useState<Key[]>([]); const [newKey,setNewKey]=useState(''); const [usage,setUsage]=useState<Array<{id:string;charged:number|null;state:string;input_tokens:number|null;output_tokens:number|null}>>([])
  const [busy,setBusy]=useState(false); const [message,setMessage]=useState(''); const [prompt,setPrompt]=useState(''); const [answer,setAnswer]=useState('')
  const slot=`promptplay:redemption:${account}`
  async function refresh(token=session) {
    const [b,k,u]=await Promise.all([request('/api/inference/balance','GET',undefined,token),request('/api/keys','GET',undefined,token),request('/api/inference/usage','GET',undefined,token)])
    setBalance(b.units);setKeys(k.keys);setUsage(u.requests)
    const saved=localStorage.getItem(slot)
    if(saved) { const data=JSON.parse(saved) as {id:string;hash?:string}; const i=await request(`/api/redemptions/${encodeURIComponent(data.id)}`,'GET',undefined,token);setIntent(i);setHash(data.hash ?? i.tx_hash ?? '') }
    else { const result=await request('/api/redemptions','GET',undefined,token) as {intents:Intent[]}; const pending=result.intents.find(i=>!i.receipt_id);if(pending){setIntent(pending);setHash(pending.tx_hash ?? '');localStorage.setItem(slot,JSON.stringify({id:pending.id}))} }
  }
  useEffect(()=>{setIntent(null);setHash('');setNewKey('');setBalance(null)},[account])
  useEffect(()=>{if(session)void refresh(session).catch(()=>setMessage('Could not load your account.'))},[session])
  async function action(fn:()=>Promise<void>){setBusy(true);setMessage('');try{await fn()}catch(e){setMessage(e instanceof Error?e.message:'Request failed.')}finally{setBusy(false)}}
  async function createIntent(){
    const created=await request('/api/redemptions','POST',{units:1});localStorage.setItem(slot,JSON.stringify({id:created.id}));await refresh()
  }
  async function transfer(){
    if(!intent || intent.receipt_id) return
    const current=await request(`/api/redemptions/${encodeURIComponent(intent.id)}`) as Intent
    if(current.account_id!==account || current.receipt_id) throw new Error('This intent is no longer available.')
    if(current.expires-Date.now()<60_000) throw new Error('The payment window is too close to expiry. Do not send this transfer.')
    const result=await callFunctionRaw({contractId:TOKEN,method:'ft_transfer',args:{receiver_id:TREASURY,amount:current.amount,memo:current.memo},gas:'30000000000000',deposit:'1'})
    const transactionHash=result.transaction?.hash
    if(!transactionHash) throw new Error('Payment was submitted without a transaction hash. Paste it below to recover your credit.')
    localStorage.setItem(slot,JSON.stringify({id:current.id,hash:transactionHash}));setHash(transactionHash)
    await request(`/api/redemptions/${encodeURIComponent(current.id)}/verify`,'POST',{transactionHash});await refresh();window.dispatchEvent(new Event('promptplay:balance'));setMessage('Transfer verified and allowance credited.')
  }
  async function verify(){if(!intent) return; localStorage.setItem(slot,JSON.stringify({id:intent.id,hash}));await request(`/api/redemptions/${encodeURIComponent(intent.id)}/verify`,'POST',{transactionHash:hash});await refresh();window.dispatchEvent(new Event('promptplay:balance'));setMessage('Transfer verified and allowance credited.')}
  async function createKey(){const result=await request('/api/keys','POST',{quota:1_000_000});setNewKey(result.key);await refresh()}
  async function ask(){
    if(!newKey || !prompt.trim()) throw new Error('Create a key and enter a prompt.')
    const models=await request('/v1/models','GET',undefined,newKey) as {data:Array<{id:string}>};const model=models.data[0]?.id
    if(!model) throw new Error('No model is available.')
    const response=await request('/v1/chat/completions','POST',{model,messages:[{role:'user',content:prompt}],max_tokens:Math.min(128,config?.maxOutputTokens ?? 0)},newKey)
    setAnswer(response.choices[0].message.content);await refresh()
  }
  return <section id="redeem" className="play-section"><div className="play-heading"><div><h2>Inference</h2></div></div>
    {!config ? <p>Redemption service unavailable.</p> : !session ? <><p>Sign a wallet message to manage your inference allowance.</p><button className="primary" disabled={busy} onClick={()=>void action(async()=>{const auth=await login();await refresh(auth)})}>Connect to gateway</button></> : <div className="play-grid">
      <div className="game-card"><h3>Redeem PCC</h3>{config.redemptionAvailable ? <p>5 PCC = 1 gateway unit. One unit funds up to ${(Number(config.microsPerUnit)/1_000_000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')} in inference.</p> : <p>New redemptions and inference are unavailable. Existing payments can still be verified.</p>}<strong>Allowance: {balance === null ? '…' : (balance/1_000_000).toFixed(6)} units</strong>
        {!intent && config.redemptionAvailable && <button className="primary" disabled={busy} onClick={()=>void action(createIntent)}>Create redemption</button>}
        {intent && !intent.receipt_id && <>{hash && <a href={`https://testnet.nearblocks.io/txns/${hash}`} target="_blank" rel="noreferrer">View transaction ↗</a>}<span>Transfer {pcc(intent.amount)} PCC before {new Date(intent.expires).toLocaleTimeString()}.</span><button className="primary" disabled={busy || !!hash || !config.redemptionAvailable} onClick={()=>void action(transfer)}>Transfer PCC</button><label>Transaction hash for recovery<input value={hash} onChange={e=>setHash(e.target.value.trim())} /></label><button disabled={busy || !hash} onClick={()=>void action(verify)}>Verify transfer</button><small>If the wallet submits but the browser loses the result, paste its transaction hash here. Do not send a second transfer for this intent.</small></>}
        {intent?.receipt_id && <><span>Payment verified.</span><button onClick={()=>{localStorage.removeItem(slot);setIntent(null);setHash('')}}>New redemption</button></>}
      </div>
      <div className="game-card"><h3>Gateway access</h3><button className="primary" disabled={busy || !config.redemptionAvailable} onClick={()=>void action(createKey)}>Create API key</button>{newKey && <div className="key-box"><strong>Copy this key now. It will not be shown again.</strong><code>{newKey}</code><button onClick={()=>void navigator.clipboard.writeText(newKey).then(()=>setMessage('Key copied.')).catch(()=>setMessage('Could not copy the key.'))}>Copy key</button></div>}
        {keys.filter(k=>!k.revoked).map(k=><div className="key-row" key={k.id}><code>{k.id.slice(0,8)}…</code><button disabled={busy} onClick={()=>void action(async()=>{await request(`/api/keys/${encodeURIComponent(k.id)}`,'DELETE');await refresh()})}>Revoke</button></div>)}
        <span>API endpoint: <code>{API}/v1</code></span>
        {newKey && <><label>Try a prompt<textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={3} maxLength={4000} /></label><button disabled={busy || !prompt.trim()} onClick={()=>void action(ask)}>Send request</button>{answer && <div className="answer">{answer}</div>}</>}
        <h3>Usage</h3>{usage.length ? usage.map(u=><small key={u.id}>{u.state} · {u.input_tokens ?? '—'} input / {u.output_tokens ?? '—'} output tokens · {u.charged === null ? 'reserved' : `${u.charged} microunits`}</small>) : <small>No requests yet.</small>}
      </div>
    </div>}{message && <p className="status" role="status">{message}</p>}
  </section>
}
