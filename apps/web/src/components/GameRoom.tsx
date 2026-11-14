import { useNearWallet } from 'near-connect-hooks'
import { getTransactionLastResult } from 'near-api-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import confetti from 'canvas-confetti'
import { motion } from 'framer-motion'
import {
  Gamepad2,
  Copy,
  Check,
  ExternalLink,
  Clock,
  ShieldCheck,
  Zap,
  Lock,
  Eye,
  Trophy,
  ArrowRight,
  Flame,
  User,
  AlertCircle,
  Coins
} from 'lucide-react'
import {
  GAME,
  TOKEN,
  amount,
  base64,
  commitment,
  confirmStakeTransfer,
  fromBase64,
  pcc,
  secretKey,
  type Match,
  type Secret
} from '../lib/game'
import { useSession } from './Session'
import { MatchHistory } from './MatchHistory'

const SNAP = { type: 'spring', stiffness: 420, damping: 24 } as const

export function GameRoom() {
  const { signedAccountId: account, callFunctionRaw, viewFunction } = useNearWallet()
  const { config, token, login, request } = useSession()

  const [opponent, setOpponent] = useState('')
  const [stake, setStake] = useState('5')
  const [id, setId] = useState(() => new URLSearchParams(window.location.search).get('match') ?? '')
  const socket = useRef<WebSocket | null>(null)
  const [loadedRoom, setRoom] = useState<Match | null>(null)
  const room = loadedRoom?.id === id ? loadedRoom : null

  const [pending, setPending] = useState(false)
  const pendingAction = useRef(false)
  const [confirmedDeposit, setConfirmedDeposit] = useState<{ account: string; matchId: string } | null>(null)
  const [message, setMessage] = useState('')
  const [txHash, setTxHash] = useState('')
  const [copiedLink, setCopiedLink] = useState(false)
  const [registered, setRegistered] = useState<boolean | null>(null)
  const [now, setNow] = useState(Date.now())
  const [selectedMove, setSelectedMove] = useState<{match:string;round:number;choice:number} | null>(null)
  const [notificationBusy, setNotificationBusy] = useState(false)
  const [notificationMatch, setNotificationMatch] = useState('')
  const indexing = useRef(false)

  const confettiFired = useRef<string | null>(null)

  const checkRegistration = useCallback(async () => {
    const value = await viewFunction({
      contractId: TOKEN,
      method: 'storage_balance_of',
      args: { account_id: account }
    })
    setRegistered(value !== null)
  }, [account, viewFunction])

  useEffect(() => {
    setRegistered(null)
    void checkRegistration().catch(() => setMessage('Could not check PCC storage registration.'))
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [checkRegistration])

  const me = room?.players.find((p) => p.account === account)

  const syncEvents = useCallback(async () => {
    if (!account || indexing.current) return
    indexing.current = true
    const key=`promptplay:events:${GAME}:${account}`
    try {
      let queue: string[] = JSON.parse(localStorage.getItem(key) ?? '[]')
      while (queue.length) {
        await request('/api/match-events','POST',{hash:queue[0],signer:account})
        const current: string[] = JSON.parse(localStorage.getItem(key) ?? '[]')
        queue=current.filter(hash=>hash!==queue[0]);localStorage.setItem(key,JSON.stringify(queue))
      }
    } catch { /* Retry when the index or RPC recovers. */ }
    finally { indexing.current = false }
  },[account,request])
  useEffect(()=>{void syncEvents();const timer=window.setInterval(()=>void syncEvents(),30000);return()=>window.clearInterval(timer)},[syncEvents])


  async function subscribeToMatch() {
    if (!room || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setMessage('Push notifications are not supported by this browser.')
      return
    }
    setNotificationBusy(true)
    try {
      if (await Notification.requestPermission() !== 'granted') throw new Error('Notification permission was not granted.')
      const {publicKey} = await request<{publicKey:string|null}>('/api/notifications/config')
      if (!publicKey) throw new Error('Match notifications are unavailable.')
      const registration = await navigator.serviceWorker.register('/push-worker.js')
      const ready = await navigator.serviceWorker.ready
      const subscription = await ready.pushManager.getSubscription() ?? await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))})
      const auth=token || await login()
      const {endpoint,keys}=subscription.toJSON()
      if(!endpoint || !keys?.p256dh || !keys.auth)throw new Error('Invalid browser push subscription.')
      await request(`/api/matches/${encodeURIComponent(room.id)}/notifications`,'POST',{endpoint,keys:{p256dh:keys.p256dh,auth:keys.auth}},auth)
      setNotificationMatch(room.id)
      setMessage('Match notification enabled.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not enable notifications.')
    } finally {
      setNotificationBusy(false)
    }
  }

  // Trigger win confetti
  useEffect(() => {
    if (room && room.phase === 'Completed' && room.winner === account) {
      if (confettiFired.current !== room.id) {
        confettiFired.current = room.id
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#00f0ff', '#ff2a6d', '#ffb800', '#10b981']
        })
      }
    }
  }, [room, account])

  const refresh = useCallback(async (matchId = id) => {
    if (!/^\d+$/.test(matchId) || BigInt(matchId) > 2n ** 64n - 1n) {
      setRoom(null)
      return
    }
    const state = (await viewFunction({
      contractId: GAME,
      method: 'get_match',
      args: { match_id: matchId }
    })) as Match | null
    setRoom(state)
  }, [id, viewFunction])

  useEffect(() => {
    if (!/^\d+$/.test(id) || BigInt(id) > 2n ** 64n - 1n) {
      setRoom(null)
      return
    }
    let stopped = false
    async function read() {
      try {
        const state = (await viewFunction({
          contractId: GAME,
          method: 'get_match',
          args: { match_id: id }
        })) as Match | null
        if (!stopped) setRoom(state)
      } catch {
        if (!stopped) setMessage('Could not load match. Verify RPC connection.')
      }
    }
    void read()
    const timer = window.setInterval(read, 12000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [id, viewFunction])

  useEffect(() => {
    if (!/^\d+$/.test(id) || BigInt(id) > 2n ** 64n - 1n) return
    let stopped = false
    let reconnect: number | undefined
    let last = 0

    const connect = () => {
      const url = new URL(import.meta.env.VITE_API_URL || 'http://localhost:3001')
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.pathname = `/rooms/${id}/ws`
      url.search = ''
      const ws = new WebSocket(url)
      socket.current = ws

      ws.onmessage = (event) => {
        try {
          if (JSON.parse(String(event.data)).type === 'resync_required' && Date.now() - last > 1500) {
            last = Date.now()
            void refresh(id).catch(() => setMessage('Could not refresh match.'))
          }
        } catch {
          /* Ignore malformed */
        }
      }
      ws.onclose = () => {
        if (!stopped) reconnect = window.setTimeout(connect, 3000)
      }
      ws.onerror = () => ws.close()
    }

    connect()
    return () => {
      stopped = true
      if (reconnect) clearTimeout(reconnect)
      socket.current?.close()
      socket.current = null
    }
  }, [id, refresh])

  async function callFunction(params: Parameters<typeof callFunctionRaw>[0]) {
    const outcome = await callFunctionRaw(params)
    if (outcome.transaction?.hash) setTxHash(outcome.transaction.hash)
    if (!outcome.status || typeof outcome.status !== 'object' || !('SuccessValue' in outcome.status)) {
      throw new Error('Transaction was not confirmed on-chain. Refresh match state before retrying.')
    }
    if(outcome.transaction?.hash){
      try {
        const key=`promptplay:events:${GAME}:${account}`
        const queue:string[]=JSON.parse(localStorage.getItem(key) ?? '[]')
        if(!queue.includes(outcome.transaction.hash))localStorage.setItem(key,JSON.stringify([...queue,outcome.transaction.hash]))
        void syncEvents()
      } catch {
        // The server can backfill events independently of browser storage.
      }
    }
    return getTransactionLastResult(outcome)
  }

  async function action(fn: () => Promise<void>, refreshAfter = true) {
    if (pendingAction.current) return
    pendingAction.current = true
    setPending(true)
    setTxHash('')
    setMessage('Waiting for wallet signature & blockchain confirmation…')
    try {
      await fn()
      window.dispatchEvent(new Event('promptplay:balance'))
      if (socket.current?.readyState === WebSocket.OPEN) {
        socket.current.send(JSON.stringify({ type: 'resync' }))
      }
      setMessage('Transaction confirmed on NEAR Testnet.')
      if (refreshAfter) {
        try {
          await refresh()
        } catch {
          setMessage('Transaction confirmed. Match refresh is unavailable. Check the explorer while the room reconnects.')
        }
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Transaction status is unknown. Check wallet history and refresh the match before retrying.')
    } finally {
      pendingAction.current = false
      setPending(false)
    }
  }

  async function claimFaucet() {
    if (pendingAction.current) return
    pendingAction.current = true
    setPending(true)
    setTxHash('')
    setMessage('Authenticating wallet challenge for Testnet faucet…')
    try {
      const auth = token || (await login())
      const previous = await request<{claim?:{tx_hash?:string; state:string}}>('/api/faucet', 'GET', undefined, auth)
      if (previous.claim) {
        if (previous.claim.tx_hash) setTxHash(previous.claim.tx_hash)
        setMessage(previous.claim.state === 'complete' ? 'Faucet claim already completed (10 PCC).' : 'Faucet claim is currently pending.')
        return
      }
      const result = await request<{claim?:{tx_hash?:string; state:string}}>('/api/faucet', 'POST', undefined, auth)
      if (result.claim?.tx_hash) setTxHash(result.claim.tx_hash)
      window.dispatchEvent(new Event('promptplay:balance'))
      setMessage(result.claim?.state === 'complete' ? '10 PCC transferred to your wallet!' : 'Faucet transfer submitted.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Faucet claim status is unknown. Check the claim status before trying again.')
    } finally {
      pendingAction.current = false
      setPending(false)
    }
  }

  async function create() {
    const value = amount(stake)
    if (!opponent.trim() || opponent.trim() === account) {
      throw new Error('Enter a valid opposing NEAR account (cannot challenge yourself).')
    }
    const result = await callFunction({
      contractId: GAME,
      method: 'create_match',
      args: { opponent: opponent.trim(), stake: value },
      gas: '100000000000000',
      deposit: '10000000000000000000000'
    })
    const matchId = String(result)
    if (!/^\d+$/.test(matchId)) throw new Error('Match created; verify transaction hash in explorer.')
    setRoom(null)
    setId(matchId)
    window.history.replaceState(null, '', `?match=${matchId}#play`)
    await refresh(matchId)
  }

  async function fund() {
    if (!room) return
    const transferred = await callFunction({
      contractId: TOKEN,
      method: 'ft_transfer_call',
      args: { receiver_id: GAME, amount: room.stake, memo: null, msg: room.id },
      gas: '100000000000000',
      deposit: '1'
    })
    confirmStakeTransfer(transferred, room.stake)
    setConfirmedDeposit({ account, matchId: room.id })
  }

  async function choose(choice: number) {
    if (!room || !me) return
    setSelectedMove({match:room.id,round:room.round,choice})
    const key = secretKey(account, room.id, room.round)
    let saved: Secret | null = null
    const existing = localStorage.getItem(key)

    if (existing) {
      saved = JSON.parse(existing) as Secret
      if (saved.choice !== choice) {
        throw new Error('A different move was already committed locally. Submit that move to complete your commitment.')
      }
    } else {
      const secret = crypto.getRandomValues(new Uint8Array(32))
      saved = {
        choice,
        secret: base64(secret),
        commitment: await commitment(account, room.id, room.round, choice, secret)
      }
      localStorage.setItem(key, JSON.stringify(saved))
    }

    await callFunction({
      contractId: GAME,
      method: 'commit_move',
      args: { match_id: room.id, commitment: saved.commitment },
      gas: '50000000000000'
    })
  }

  async function reveal() {
    if (!room || !me) return
    const raw = localStorage.getItem(secretKey(account, room.id, room.round))
    if (!raw) {
      throw new Error('Saved move secret not found in this browser. Reveal must happen on the same device.')
    }
    const saved = JSON.parse(raw) as Secret
    const computed = await commitment(account, room.id, room.round, saved.choice, fromBase64(saved.secret))
    if (computed !== saved.commitment || !me.commitment || base64(Uint8Array.from(me.commitment)) !== computed) {
      throw new Error('Locally saved move does not match the on-chain commitment hash.')
    }
    await callFunction({
      contractId: GAME,
      method: 'reveal_move',
      args: { match_id: room.id, choice: saved.choice, secret: saved.secret },
      gas: '50000000000000'
    })
  }

  const movesList = [
    { id: 0, name: 'Rock', icon: '/hands/rock.svg' },
    { id: 1, name: 'Paper', icon: '/hands/paper.svg' },
    { id: 2, name: 'Scissors', icon: '/hands/scissors.svg' }
  ]

  const timeLeft = room && ['Funding', 'Committing', 'Revealing'].includes(room.phase)
    ? Math.max(0, Math.ceil((Number(BigInt(room.deadline) / 1000000n) - now) / 1000))
    : 0

  const canChoose = Boolean(me && room?.phase === 'Committing' && !me.commitment && !pending)

  // Arcade controls: keys 1/2/3 pick Rock/Paper/Scissors.
  useEffect(() => {
    if (!canChoose) return
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select') || event.repeat) return
      const move = movesList[Number(event.key) - 1]
      if (move) void action(() => choose(move.id))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function copyInvite() {
    if (!room) return
    const url = new URL(window.location.href)
    url.searchParams.set('match', room.id)
    url.hash = 'play'
    void navigator.clipboard.writeText(url.toString()).then(() => {
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2500)
    })
  }

  return (
    <div className="arena-container">
      {room && <div>Round {room.round} · {room.players[0].account}: {room.wins[0]} — {room.players[1].account}: {room.wins[1]} {me && !['Completed','Cancelled'].includes(room.phase) && <button type="button" disabled={notificationBusy || notificationMatch === room.id} onClick={()=>void subscribeToMatch()}>{notificationMatch === room.id ? 'Notifications enabled' : 'Notify me'}</button>}</div>}
      <MatchHistory key={account} account={account} onSelect={matchId=>{setRoom(null);setId(matchId);window.history.replaceState(null,'',`?match=${matchId}#play`)}} />
      {/* ARENA TOPBAR */}
      <div className="arena-topbar">
        <a href="#arcade" className="back-btn">
          <span>← Back to Arcade</span>
        </a>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          {registered === false && (
            <button type="button"
              className="btn-accent"
              style={{ fontSize: '12px', padding: '6px 14px' }}
              disabled={pending}
              onClick={() =>
                void action(async () => {
                  await callFunction({
                    contractId: TOKEN,
                    method: 'storage_deposit',
                    args: { account_id: account, registration_only: true },
                    deposit: '1250000000000000000000',
                    gas: '30000000000000'
                  })
                  await checkRegistration()
                })
              }
            >
              Register PCC Storage · 0.00125 NEAR
            </button>
          )}

          {config?.faucetAvailable && registered && (
            <button type="button"
              className="btn-ghost"
              style={{ fontSize: '12px', padding: '6px 14px', borderColor: 'var(--amber)', color: 'var(--amber)' }}
              disabled={pending}
              onClick={() => void claimFaucet()}
            >
              <Zap size={14} />
              <span>Claim 10 PCC Faucet</span>
            </button>
          )}

          <a href={`https://testnet.nearblocks.io/address/${GAME}`} target="_blank" rel="noreferrer" className="arena-contract-link">
            <span>Contract Proof ↗</span>
          </a>
        </div>
      </div>

      {!room && <p>Bring a second Testnet wallet, Testnet NEAR for fees and storage, and enough PCC in each wallet for the stake. Share the room link after creating the match.</p>}

      {/* MATCH STEPPER */}
      {room && (
        <section className="arena-stepper" aria-label="Match progression">
          {[
            { phase: 'Funding', label: 'Deposit' },
            { phase: 'Committing', label: 'Commit' },
            { phase: 'Revealing', label: 'Reveal' },
            { phase: 'Completed', label: 'Payout' }
          ].map((step, idx) => {
            const phaseOrder = ['Funding', 'Committing', 'Revealing', 'Completed']
            const currentIdx = phaseOrder.indexOf(room.phase)
            const isActive = room.phase === step.phase
            const isDone = currentIdx > idx || (room.phase === 'Completed' && idx <= 3)

            return (
              <div
                key={step.phase}
                className={`stepper-node ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}
              >
                <span className="stepper-node-number">{idx + 1}</span>
                <span>{step.label}</span>
              </div>
            )
          })}
        </section>
      )}

      {/* ACTIVE MATCH HUD */}
      {room ? (
        <div className="match-hud-panel">
          <div className="match-hud-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="match-id-badge">MATCH #{room.id}</span>
              <span className="match-phase-pill">{room.phase.toUpperCase()}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--amber)' }}>
                {pcc(room.stake)} PCC STAKE
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              {['Funding', 'Committing', 'Revealing'].includes(room.phase) && (
                <div className="match-timer-badge">
                  <Clock size={16} />
                  <span>{timeLeft}s</span>
                </div>
              )}
              <button type="button" className="btn-ghost" style={{ fontSize: '12px', padding: '6px 12px' }} onClick={copyInvite}>
                {copiedLink ? <Check size={14} color="var(--emerald)" /> : <Copy size={14} />}
                <span>{copiedLink ? 'Copied' : 'Invite Link'}</span>
              </button>
            </div>
          </div>

          {/* VERSUS HUD ROW */}
          <div className="versus-grid">
            {/* Player 1 (You) */}
            <div className={`fighter-card ${room.players[0].account === account ? 'is-me' : ''}`}>
              <div className="fighter-header">
                <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--cyan)' }}>
                  PLAYER 01 {room.players[0].account === account ? '(YOU)' : ''}
                </span>
                <span className="fighter-status">
                  {room.players[0].funded ? (
                    <span style={{ color: 'var(--emerald)' }}>✓ Deposited</span>
                  ) : (
                    <span style={{ color: 'var(--text-dim)' }}>Awaiting deposit</span>
                  )}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <User size={18} color="var(--text-muted)" />
                <span className="fighter-name">{room.players[0].account}</span>
              </div>
              <div style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                {room.players[0].revealed !== null ? (
                  <span style={{ color: 'var(--cyan)', fontWeight: 800 }}>
                    Revealed: {movesList[room.players[0].revealed]?.name}
                  </span>
                ) : room.players[0].commitment ? (
                  <span style={{ color: 'var(--amber)' }}>🔒 Move Sealed</span>
                ) : (
                  <span>Thinking...</span>
                )}
              </div>
            </div>

            {/* VS Badge */}
            <div className="versus-badge">
              <span>VS</span>
            </div>

            {/* Player 2 (Opponent) */}
            <div className={`fighter-card ${room.players[1].account === account ? 'is-me' : ''}`}>
              <div className="fighter-header">
                <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--crimson)' }}>
                  PLAYER 02 {room.players[1].account === account ? '(YOU)' : ''}
                </span>
                <span className="fighter-status">
                  {room.players[1].funded ? (
                    <span style={{ color: 'var(--emerald)' }}>✓ Deposited</span>
                  ) : (
                    <span style={{ color: 'var(--text-dim)' }}>Awaiting deposit</span>
                  )}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <User size={18} color="var(--text-muted)" />
                <span className="fighter-name">{room.players[1].account}</span>
              </div>
              <div style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                {room.players[1].revealed !== null ? (
                  <span style={{ color: 'var(--cyan)', fontWeight: 800 }}>
                    Revealed: {movesList[room.players[1].revealed]?.name}
                  </span>
                ) : room.players[1].commitment ? (
                  <span style={{ color: 'var(--amber)' }}>🔒 Move Sealed</span>
                ) : (
                  <span>Thinking...</span>
                )}
              </div>
            </div>
          </div>

          {/* GAME ACTION CONTROLS */}
          {me && room.phase === 'Funding' && !me.funded && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <button type="button" className="btn-primary" disabled={pending || (confirmedDeposit?.account === account && confirmedDeposit.matchId === room.id)} onClick={() => void action(fund)}>
                <ShieldCheck size={18} />
                <span>{confirmedDeposit?.account === account && confirmedDeposit.matchId === room.id ? 'Deposit confirmed · updating match…' : `Deposit ${pcc(room.stake)} PCC Into Escrow`}</span>
              </button>
            </div>
          )}

          {me && room.phase === 'Committing' && !me.commitment && (
            <div>
              <div className="move-selection-deck">
                {movesList.map((move, i) => {
                  const selected = selectedMove?.match === room.id && selectedMove.round === room.round && selectedMove.choice === move.id
                  return (
                    <motion.button
                      key={move.id}
                      type="button"
                      className={`move-card-btn ${selected ? 'selected' : ''} ${pending && selected ? 'locking' : ''}`}
                      disabled={pending}
                      onClick={() => void action(() => choose(move.id))}
                      initial={{ opacity: 0, y: 24, rotate: (i - 1) * -4 }}
                      animate={{
                        opacity: pending && !selected ? 0.35 : 1,
                        y: 0,
                        rotate: 0,
                      }}
                      whileHover={pending ? undefined : { y: -8, scale: 1.04, transition: SNAP }}
                      whileTap={pending ? undefined : { scale: 0.94, transition: SNAP }}
                      transition={{ type: 'spring', stiffness: 380, damping: 24, delay: i * 0.06 }}
                    >
                      <span className="move-keycap" aria-hidden="true">{i + 1}</span>
                      <img src={move.icon} alt="" />
                      <span className="move-card-label">{move.name}</span>
                    </motion.button>
                  )
                })}
              </div>
            </div>
          )}

          {me && room.phase === 'Committing' && me.commitment && (
            <motion.div
              style={{ textAlign: 'center', padding: '24px 0', background: 'var(--surface-card)', borderRadius: '16px' }}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={SNAP}
            >
              <motion.div
                style={{ display: 'inline-block', marginBottom: '8px' }}
                initial={{ y: -14, rotate: -20 }}
                animate={{ y: 0, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 600, damping: 14, delay: 0.08 }}
              >
                <Lock size={28} color="var(--amber)" />
              </motion.div>
              <h4 style={{ margin: '0', fontFamily: 'var(--font-display)' }}>Move Sealed · Waiting for Opponent</h4>
            </motion.div>
          )}

          {me && room.phase === 'Revealing' && me.revealed === null && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <button type="button" className="btn-accent" disabled={pending} onClick={() => void action(reveal)}>
                <Eye size={18} />
                <span>Reveal Secret Move</span>
              </button>
            </div>
          )}

          {/* OUTCOME / WINNER BANNER */}
          {(room.phase === 'Completed' || room.phase === 'Cancelled') && (
            <div className="winner-banner">
              {room.winner ? (
                <>
                  <Trophy size={42} color="var(--amber)" style={{ marginBottom: '12px' }} />
                  <h2>{room.winner === account ? '🎉 Victory!' : `${room.winner} Wins`}</h2>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--amber)', marginTop: '4px' }}>
                    {pcc((BigInt(room.stake) * 2n).toString())} PCC pot · includes the winner’s original stake
                  </div>
                </>
              ) : room.phase === 'Completed' ? (
                <>
                  <ShieldCheck size={42} color="var(--cyan)" style={{ marginBottom: '12px' }} />
                  <h2 style={{ color: 'var(--cyan)' }}>Match Tied</h2>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    {me && BigInt(me.claim) > 0n ? 'Refund available to claim' : me?.pending ? 'Refund transfer pending' : 'Match tied · check payout status'}
                  </div>
                </>
              ) : (
                <>
                  <AlertCircle size={42} color="var(--crimson)" style={{ marginBottom: '12px' }} />
                  <h2 style={{ color: 'var(--crimson)' }}>Match Cancelled</h2>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    {me && BigInt(me.claim) > 0n ? 'Refund available to claim' : me?.pending ? 'Refund transfer pending' : 'Check match history for settlement'}
                  </div>
                </>
              )}

              {me && BigInt(me.claim) > 0n && (
                <div style={{ marginTop: '20px', display: 'flex', gap: '14px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button type="button"
                    className="btn-primary"
                    disabled={pending || me.pending}
                    onClick={() =>
                      void action(async () => {
                        const paid: unknown = await callFunction({
                          contractId: GAME,
                          method: 'claim_payout',
                          args: { match_id: room.id },
                          gas: '70000000000000',
                          deposit: '1'
                        })
                        if (paid === false) {
                          throw new Error('PCC transfer failed. The contract restored the claim. Refresh the match before retrying.')
                        }
                        if (paid !== true) {
                          throw new Error('Payout status is unknown. Check the explorer and refresh the match before retrying.')
                        }
                      })
                    }
                  >
                    <Coins size={16} />
                    <span>Claim {pcc(me.claim)} PCC Payout</span>
                  </button>
                </div>
              )}
              {me?.pending && <output>Payout transfer pending. Check the explorer or wait for the room to refresh.</output>}
              {me && !me.pending && BigInt(me.claim) === 0n && room.winner === account && (
                <p><a href="#redeem" className="btn-accent">Open Inference Hub · 5 PCC per unit</a></p>
              )}
            </div>
          )}

          {/* TIMEOUT RESOLUTION */}
          {['Funding', 'Committing', 'Revealing'].includes(room.phase) &&
            now >= Number(BigInt(room.deadline) / 1000000n) && (
              <div style={{ textAlign: 'center', marginTop: '20px' }}>
                <button type="button"
                  className="btn-ghost"
                  style={{ borderColor: 'var(--crimson)', color: 'var(--crimson)' }}
                  disabled={pending}
                  onClick={() =>
                    void action(() =>
                      callFunction({
                        contractId: GAME,
                        method: 'resolve_timeout',
                        args: { match_id: room.id },
                        gas: '50000000000000'
                      }).then(() => {})
                    )
                  }
                >
                  <Clock size={16} />
                  <span>Resolve Timeout & Liquidate Escrow</span>
                </button>
              </div>
            )}
        </div>
      ) : null}

      {/* CREATE / JOIN ARENA SECTION */}
      {!room && (
        <div className="duel-stage-grid">
          {/* Create Match */}
          <div className="duel-card">
            <h3>
              <Flame size={20} color="var(--cyan)" />
              <span>Create Duel Match</span>
            </h3>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                void action(create, false)
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}
            >
              <label className="field-label">
                <span>Opponent</span>
                <input
                  className="input-field"
                  required
                  disabled={pending}
                  value={opponent}
                  onChange={(e) => setOpponent(e.target.value)}
                  placeholder="friend.testnet"
                />
              </label>

              <label className="field-label">
                <span>Stake (PCC)</span>
                <input
                  className="input-field"
                  required
                  disabled={pending}
                  value={stake}
                  onChange={(e) => setStake(e.target.value)}
                  inputMode="decimal"
                />
              </label>

              {/* Quick stake chips */}
              <div style={{ display: 'flex', gap: '8px' }}>
                {['1', '5', '10', '25'].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="btn-ghost"
                    style={{
                      padding: '4px 10px',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
                      borderColor: stake === chip ? 'var(--cyan)' : 'var(--border)'
                    }}
                    onClick={() => setStake(chip)}
                  >
                    {chip} PCC
                  </button>
                ))}
              </div>

              <button type="submit" className="btn-primary" disabled={pending} style={{ width: '100%' }}>
                <Gamepad2 size={16} />
                <span>Create Duel · 0.01 NEAR</span>
              </button>
            </form>
          </div>

          {/* Join Match by ID */}
          <div className="duel-card">
            <h3>
              <Zap size={20} color="var(--amber)" />
              <span>Join Existing Duel</span>
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <label className="field-label">
                <span>Match ID</span>
                <input
                  className="input-field"
                  disabled={pending}
                  value={id}
                  onChange={(e) => setId(e.target.value.trim())}
                  inputMode="numeric"
                  placeholder="e.g. 0"
                />
              </label>

              <button type="button"
                className="btn-ghost"
                disabled={pending || !id}
                onClick={() => void refresh(id)}
                style={{ width: '100%' }}
              >
                <span>Load Match</span>
                <ArrowRight size={14} />
              </button>

              {id && !room && (
                <p style={{ color: 'var(--crimson)', fontSize: '13px', margin: 0 }}>
                  Match #{id} not found. Verify the match ID or check the contract explorer.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* STATUS TOAST NOTIFICATION */}
      {message && (
        <output className="status-toast">
          <span>{message}</span>
          {txHash && (
            <a
              href={`https://testnet.nearblocks.io/txns/${txHash}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--cyan)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <span>Explorer</span>
              <ExternalLink size={13} />
            </a>
          )}
        </output>
      )}
    </div>
  )
}
