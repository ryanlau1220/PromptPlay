import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowDown, ArrowRight, Check, CircleDollarSign, Code2, Gamepad2, LockKeyhole, ShieldCheck, Swords, Users } from 'lucide-react'

const phases = ['select', 'invite', 'deposit', 'commit', 'reveal', 'claim'] as const
type Phase = typeof phases[number]

function AgentTerminal({ started, reduced }: { started: boolean; reduced: boolean | null }) {
  return (
    <div className="hero-window hero-agent">
      <div className="hero-window-bar"><div className="hero-window-title"><Code2 size={14} /> agent</div><span className="hero-window-badge">SIMULATED</span></div>
      <div className="agent-content" aria-label="Illustrative agent activity">
        <motion.div className={`agent-request ${started ? 'is-sent' : ''}`} layout transition={reduced ? { duration: 0 } : { duration: .55, ease: 'easeInOut' }}>
          <div className="agent-prompt-label">{started ? 'YOU' : 'PROMPT'}</div>
          <div className="agent-prompt"><span className="agent-prompt-first">Give me a production-ready product.</span><span className="agent-prompt-second">Make no mistakes<span className="agent-cursor">▍</span></span></div>
          {!started && <span className="agent-send" aria-hidden="true"><ArrowRight size={16} /></span>}
        </motion.div>
        {started && <motion.div className="agent-response" initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .4 }}>
          <div className="agent-divider" />
          <div className="agent-response-label"><span /> AGENT</div>
          <div className="agent-line agent-line-one"><span>›</span> Inspecting the project structure</div>
          <div className="agent-line agent-line-two"><span>›</span> Mapping the existing flows</div>
          <div className="agent-line agent-line-three"><span>›</span> Implementing the changes</div>
          <div className="agent-line agent-line-four"><span>✓</span> Running checks and tests</div>
          <div className="agent-thinking"><span className="thinking-spinner" /> Working<span className="thinking-dots">...</span></div>
        </motion.div>}
      </div>
      <div className="hero-window-bottom"><span><span className="agent-status-dot" /> {started ? 'RUNNING' : 'READY'}</span><span>~ / workspace</span></div>
    </div>
  )
}

function PhaseScreen({ phase }: { phase: Phase }) {
  if (phase === 'select') return <div className="demo-screen demo-select"><span className="demo-eyebrow">CHOOSE A GAME</span><div className="demo-game"><div className="demo-game-art"><Gamepad2 size={32} strokeWidth={1.5} /><span /><i /></div><div><span className="demo-minor">2 PLAYERS · PCC</span><strong>Rock Paper Scissors</strong></div><ArrowRight size={19} /></div><div className="demo-action"><span>Select game</span><ArrowRight size={15} /></div></div>
  if (phase === 'invite') return <div className="demo-screen"><span className="demo-eyebrow">PRIVATE MATCH</span><div className="demo-icon demo-cyan"><Users size={27} /></div><strong>Challenge a friend</strong><div className="demo-players"><span>you.testnet</span><i>↔</i><span>friend.testnet</span></div><div className="demo-action"><span>Invite shared</span><Check size={15} /></div></div>
  if (phase === 'deposit') return <div className="demo-screen"><span className="demo-eyebrow">DEPOSIT TO ESCROW</span><div className="demo-icon demo-amber"><ShieldCheck size={27} /></div><strong>5 PCC each</strong><div className="demo-players"><span>YOU <b>✓</b></span><i>+</i><span>FRIEND <b>✓</b></span></div><div className="demo-action"><span>Both deposits confirmed</span><LockKeyhole size={14} /></div></div>
  if (phase === 'commit') return <div className="demo-screen"><span className="demo-eyebrow">COMMIT YOUR MOVE</span><div className="demo-hands">{['rock', 'paper', 'scissors'].map((hand, i) => <div className={i === 0 ? 'demo-hand selected' : 'demo-hand'} key={hand}><img src={`/hands/${hand}.svg`} alt="" /></div>)}</div><strong>Move sealed</strong><div className="demo-commit"><LockKeyhole size={13} /> Waiting for both players</div></div>
  if (phase === 'reveal') return <div className="demo-screen"><span className="demo-eyebrow">REVEAL</span><div className="demo-duel"><div><img src="/hands/rock.svg" alt="" /><span>YOU</span></div><Swords size={19} /><div><img src="/hands/scissors.svg" alt="" /><span>FRIEND</span></div></div><strong>Rock beats scissors</strong><div className="demo-result">YOU WIN</div></div>
  return <div className="demo-screen"><span className="demo-eyebrow">MATCH COMPLETE</span><div className="demo-icon demo-win"><CircleDollarSign size={31} /></div><strong>10 PCC claimed</strong><div className="demo-commit"><Check size={14} /> Payout confirmed</div><div className="demo-replay">BACK TO ARCADE <ArrowRight size={13} /></div></div>
}

function GameTerminal({ started }: { started: boolean }) {
  const reduced = useReducedMotion()
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (reduced || !started) return
    const timer = window.setInterval(() => { if (!document.hidden) setIndex((current) => (current + 1) % phases.length) }, 3800)
    return () => clearInterval(timer)
  }, [reduced, started])
  const phase = reduced ? 'claim' : phases[index]!
  return (
    <div className="hero-window hero-game">
      <div className="hero-window-bar"><div className="hero-window-title"><Gamepad2 size={15} /> arcade</div><span className="hero-window-badge">SIMULATED</span></div>
      <div className="game-terminal-stage" aria-label="Simulated arcade flow: choose a game, invite a friend, deposit, commit, reveal, and claim.">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div className="demo-frame" key={phase} initial={reduced ? false : { opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: -7 }} transition={{ duration: .25 }}>
            <PhaseScreen phase={phase} />
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="hero-window-bottom"><span>ARCADE / 01</span><div className="demo-progress" aria-hidden="true">{phases.map((step, i) => <span className={i === (reduced ? phases.length - 1 : index) ? 'active' : ''} key={step} />)}</div></div>
    </div>
  )
}

export function ArcadeScene() {
  const reduced = useReducedMotion()
  const [started, setStarted] = useState(false)
  useEffect(() => {
    if (reduced) { setStarted(true); return }
    const timer = window.setTimeout(() => setStarted(true), 5000)
    return () => window.clearTimeout(timer)
  }, [reduced])
  return (
    <section className="arcade-hero" aria-label="PromptPlay arcade">
      <h1 className="visually-hidden">PromptPlay arcade</h1>
      <div className="hero-shell">
        <div className="hero-shell-bar"><div className="hero-lights" aria-hidden="true"><i /><i /><i /></div><span>promptplay / workspace</span><span>DEMO</span></div>
        <div className="hero-workspace"><AgentTerminal started={started} reduced={reduced} /><GameTerminal started={started} /></div>
      </div>
      <div className="hero-actions-row"><a className="hero-action-primary" href="#games"><Gamepad2 size={16} /> Play <ArrowRight size={15} /></a><a className="hero-action-link" href="#redeem">Compute <ArrowRight size={15} /></a><a className="hero-action-scroll" href="#loop" aria-label="Explore PromptPlay"><ArrowDown size={18} /></a></div>
    </section>
  )
}
