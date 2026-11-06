import { useNearWallet } from 'near-connect-hooks'
import { getTransactionLastResult } from 'near-api-js'
import { useEffect, useRef, useState } from 'react'
import { GAME, TOKEN, amount, base64, commitment, fromBase64, pcc, secretKey, type Match, type Secret } from '../lib/game'
import { useSession } from './Session'

export function GameRoom() {
  const { signedAccountId: account, callFunctionRaw, viewFunction } = useNearWallet()
  const {config,token,login,request}=useSession()
  const [opponent, setOpponent] = useState(''); const [stake, setStake] = useState('5')
  const [id, setId] = useState(() => new URLSearchParams(window.location.search).get('match') ?? '')
  const socket = useRef<WebSocket | null>(null)
  const [loadedRoom, setRoom] = useState<Match | null>(null); const room = loadedRoom?.id === id ? loadedRoom : null; const [pending, setPending] = useState(false); const [message, setMessage] = useState(''); const [txHash,setTxHash]=useState('')
  const [registered, setRegistered] = useState<boolean | null>(null); const [now, setNow] = useState(Date.now())
  async function checkRegistration() { const value = await viewFunction({contractId:TOKEN,method:'storage_balance_of',args:{account_id:account}}); setRegistered(value !== null) }
  useEffect(() => { setRegistered(null); void checkRegistration().catch(()=>setMessage('Could not check PCC registration.')); const timer = window.setInterval(()=>setNow(Date.now()),1000); return ()=>clearInterval(timer) }, [account])
  const me = room?.players.find(p => p.account === account)
  async function refresh(matchId = id) {
    if (!/^\d+$/.test(matchId) || BigInt(matchId) > 2n**64n-1n) { setRoom(null); return }
    const state = await viewFunction({contractId:GAME,method:'get_match',args:{match_id:matchId}}) as Match | null
    setRoom(state)
  }
  useEffect(() => {
    if (!/^\d+$/.test(id) || BigInt(id) > 2n**64n-1n) { setRoom(null); return }
    let stopped = false
    async function read() { try { const state = await viewFunction({contractId:GAME,method:'get_match',args:{match_id:id}}) as Match|null; if (!stopped) setRoom(state) } catch { if (!stopped) setMessage('Could not load match. Try again.') } }
    void read(); const timer = window.setInterval(read, 15000); return () => { stopped = true; clearInterval(timer) }
  }, [id, account])
  useEffect(() => {
    if (!/^\d+$/.test(id) || BigInt(id) > 2n**64n-1n) return
    let stopped=false; let reconnect:number|undefined; let last=0
    const connect=()=>{
      const url=new URL(import.meta.env.VITE_API_URL || 'http://localhost:3001');url.protocol=url.protocol==='https:'?'wss:':'ws:';url.pathname=`/rooms/${id}/ws`;url.search=''
      const ws=new WebSocket(url);socket.current=ws
      ws.onmessage=event=>{try{if(JSON.parse(String(event.data)).type==='resync_required' && Date.now()-last>1500){last=Date.now();void refresh(id).catch(()=>setMessage('Could not refresh match.'))}}catch{/* Ignore malformed notifications. */}}
      ws.onclose=()=>{if(!stopped) reconnect=window.setTimeout(connect,3000)}
      ws.onerror=()=>ws.close()
    }
    connect();return()=>{stopped=true;if(reconnect)clearTimeout(reconnect);socket.current?.close();socket.current=null}
  }, [id, account])
  async function callFunction(params:Parameters<typeof callFunctionRaw>[0]) {
    const outcome=await callFunctionRaw(params)
    if(outcome.transaction?.hash)setTxHash(outcome.transaction.hash)
    if(!outcome.status || typeof outcome.status!=='object' || !('SuccessValue' in outcome.status)) throw new Error('Transaction was not confirmed. Check the explorer and refresh the match before retrying.')
    return getTransactionLastResult(outcome)
  }
  async function action(fn:()=>Promise<void>, refreshAfter=true) {
    setPending(true); setTxHash(''); setMessage('Waiting for wallet and network confirmation…')
    try { await fn(); window.dispatchEvent(new Event('promptplay:balance')); if(socket.current?.readyState===WebSocket.OPEN) socket.current.send(JSON.stringify({type:'resync'})); setMessage('Transaction submitted. Checking on-chain status.'); if(refreshAfter) await refresh() }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Transaction was not completed.') }
    finally { setPending(false) }
  }
  async function claimFaucet() {
    setPending(true); setTxHash(''); setMessage('Waiting for wallet authentication…')
    try { const auth=token || await login(); const previous=await request('/api/faucet','GET',undefined,auth); if(previous.claim){if(previous.claim.tx_hash)setTxHash(previous.claim.tx_hash);setMessage(previous.claim.state==='complete' ? 'Your faucet claim was already completed.' : 'Faucet claim is pending.');return} const result=await request('/api/faucet','POST',undefined,auth); if(result.claim?.tx_hash)setTxHash(result.claim.tx_hash); window.dispatchEvent(new Event('promptplay:balance')); setMessage(result.claim?.state==='complete' ? '10 PCC sent.' : 'Faucet claim is pending. Do not submit another request.') }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Faucet request failed.') }
    finally { setPending(false) }
  }
  async function create() {
    const value = amount(stake)
    if (!opponent.trim() || opponent.trim() === account) throw new Error('Enter another player’s NEAR account.')
    const result = await callFunction({contractId:GAME,method:'create_match',args:{opponent:opponent.trim(),stake:value},gas:'100000000000000',deposit:'10000000000000000000000'})
    const matchId = String(result); if (!/^\d+$/.test(matchId)) throw new Error('Match submitted; find its ID in the wallet transaction before continuing.')
    setRoom(null); setId(matchId); window.history.replaceState(null,'',`?match=${matchId}#play`); await refresh(matchId)
  }
  async function fund() {
    if (!room) return
    await callFunction({contractId:TOKEN,method:'ft_transfer_call',args:{receiver_id:GAME,amount:room.stake,memo:null,msg:room.id},gas:'100000000000000',deposit:'1'})
  }
  async function choose(choice:number) {
    if (!room || !me) return
    const key = secretKey(account, room.id); let saved:Secret|null = null
    const existing = localStorage.getItem(key)
    if (existing) { saved = JSON.parse(existing) as Secret; if (saved.choice !== choice) throw new Error('A move is already saved for this match. Use the same move to retry.') }
    else { const secret = crypto.getRandomValues(new Uint8Array(32)); saved = {choice,secret:base64(secret),commitment:await commitment(account,room.id,choice,secret)}; localStorage.setItem(key,JSON.stringify(saved)) }
    await callFunction({contractId:GAME,method:'commit_move',args:{match_id:room.id,commitment:saved.commitment},gas:'50000000000000'})
  }
  async function reveal() {
    if (!room || !me) return
    const raw = localStorage.getItem(secretKey(account,room.id)); if (!raw) throw new Error('Your saved move is missing. You must reveal from the browser where you committed it.')
    const saved = JSON.parse(raw) as Secret; const computed = await commitment(account,room.id,saved.choice,fromBase64(saved.secret))
    if (computed !== saved.commitment || !me.commitment || base64(Uint8Array.from(me.commitment)) !== computed) throw new Error('The saved move does not match the on-chain commitment.')
    await callFunction({contractId:GAME,method:'reveal_move',args:{match_id:room.id,choice:saved.choice,secret:saved.secret},gas:'50000000000000'})
  }
  return <section id="play" className="play-section">
    <div className="play-heading"><div><h2>Rock Paper Scissors</h2></div><a href={`https://testnet.nearblocks.io/address/${GAME}`} target="_blank" rel="noreferrer">View contract ↗</a></div>
    {registered === false && <div className="registration"><span>Register your wallet to hold PCC.</span><button disabled={pending} onClick={()=>void action(async()=>{await callFunction({contractId:TOKEN,method:'storage_deposit',args:{account_id:account,registration_only:true},deposit:'1250000000000000000000',gas:'30000000000000'});await checkRegistration()})}>Register · 0.00125 NEAR</button></div>}
    {config?.faucetAvailable && registered && <div className="registration"><span>Need test credits?</span><button disabled={pending} onClick={()=>void claimFaucet()}>Get 10 test PCC</button></div>}
    <div className="play-grid">
      <form className="game-card" onSubmit={e=>{e.preventDefault(); void action(create,false)}}><h3>Create match</h3><label>Opponent account<input required disabled={pending} value={opponent} onChange={e=>setOpponent(e.target.value)} placeholder="friend.testnet" /></label><label>Stake (PCC)<input required disabled={pending} value={stake} onChange={e=>setStake(e.target.value)} inputMode="decimal" /></label><button className="primary" disabled={pending}>Create match</button><small>Creating a match requires 0.01 NEAR for storage.</small></form>
      <div className="game-card"><h3>Join match</h3><label>Match ID<input disabled={pending} value={id} onChange={e=>setId(e.target.value.trim())} inputMode="numeric" placeholder="Enter match ID" /></label>{room ? <><ol className="match-steps" aria-label="Match progress">{['Funding','Committing','Revealing','Completed'].map((phase, index) => <li key={phase} className={room.phase === phase ? 'current' : ['Funding','Committing','Revealing','Completed'].indexOf(room.phase) > index ? 'done' : ''}><span>{index + 1}</span>{['Fund','Choose','Reveal','Result'][index]}</li>)}</ol><div className="match-info"><strong>Match #{room.id}</strong><span>{room.phase} · {pcc(room.stake)} PCC each</span>{['Funding','Committing','Revealing'].includes(room.phase) && <span>{Math.max(0,Math.ceil((Number(BigInt(room.deadline)/1000000n)-now)/1000))}s remaining</span>}{room.players.map(p=><span key={p.account}>{p.account} {p.funded ? '✓' : '· awaiting deposit'}</span>)}</div><button type="button" className="text-button" onClick={()=>{const url = new URL(window.location.href);url.searchParams.set('match',room.id);url.hash='play';void navigator.clipboard.writeText(url.toString()).then(()=>setMessage('Invite link copied.')).catch(()=>setMessage('Could not copy the invite link.'))}}>Copy invite link ↗</button>
      {me && room.phase === 'Funding' && !me.funded && <button className="primary" disabled={pending} onClick={()=>void action(fund)}>Deposit {pcc(room.stake)} PCC</button>}
      {me && room.phase === 'Committing' && !me.commitment && <><p>Choose your move</p><div className="moves">{['Rock','Paper','Scissors'].map((move,i)=><button key={move} disabled={pending} onClick={()=>void action(()=>choose(i))}>{move}</button>)}</div><small>Keep this browser’s data until you reveal your move.</small></>}
      {me && room.phase === 'Revealing' && me.revealed === null && <button className="primary" disabled={pending} onClick={()=>void action(reveal)}>Reveal move</button>}
      {(room.phase === 'Completed' || room.phase === 'Cancelled') && <strong>{room.winner ? `${room.winner} wins` : room.phase === 'Completed' ? 'Tie' : 'Match cancelled'}</strong>}
      {me && BigInt(me.claim) > 0n && <button className="primary" disabled={pending || me.pending} onClick={()=>void action(()=>callFunction({contractId:GAME,method:'claim_payout',args:{match_id:room.id},gas:'70000000000000',deposit:'1'}).then(()=>{}))}>Claim {pcc(me.claim)} PCC</button>}
      {['Funding','Committing','Revealing'].includes(room.phase) && now >= Number(BigInt(room.deadline)/1000000n) && <button disabled={pending} onClick={()=>void action(()=>callFunction({contractId:GAME,method:'resolve_timeout',args:{match_id:room.id},gas:'50000000000000'}).then(()=>{}))}>Resolve timeout</button>}
      {!me && <small>Only the invited accounts can play this match.</small>}</> : id && /^\d+$/.test(id) ? <p>Match not found.</p> : null}</div>
    </div>{message && <p className="status" role="status">{message} {txHash && <a href={`https://testnet.nearblocks.io/txns/${txHash}`} target="_blank" rel="noreferrer">View transaction ↗</a>}</p>}
  </section>
}
