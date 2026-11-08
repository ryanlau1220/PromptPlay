import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Check, CircleDollarSign, Code2, Gamepad2, LockKeyhole, ShieldCheck, Swords, Users, PanelLeft, Plus, Folder, Settings2 } from 'lucide-react'
import { practiceGames } from './practice/games'
import { GameArtwork } from './practice/GameArtwork'

const phases = ['select', 'invite', 'deposit', 'commit', 'reveal', 'claim'] as const
type Phase = typeof phases[number]

function AgentTerminal({ started, reduced }: { started: boolean; reduced: boolean | null }) {
  return (
    <div className="hero-window hero-agent">
      <div className="hero-window-bar"><div className="hero-window-title"><Code2 size={14} /> Workspace</div><span className="hero-window-badge">SIMULATED</span></div>
      <section className={`agent-content ${started ? 'agent-active' : ''}`} aria-label="Illustrative agent activity">
        <AnimatePresence mode="wait" initial={false}>
          {!started ? <motion.div key="prompt" className="agent-request" exit={reduced ? undefined : { opacity: 0, height: 0, y: -18, margin: 0, paddingTop: 0, paddingBottom: 0 }} transition={{ duration: .45 }}>
            <div className="agent-prompt-label">PROMPT</div>
            <div className="agent-prompt"><span className="agent-prompt-first">Give me a production-ready product.</span><span className="agent-prompt-second">Make no mistakes<span className="agent-cursor">▍</span></span></div>
            <span className="agent-send" aria-hidden="true"><ArrowRight size={16} /></span>
          </motion.div> : <motion.div key="response" className="agent-response" initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .4 }}>
            <div className="agent-response-label"><span /> WORKING</div>
            <div className="agent-summary">Building your product<span className="agent-cursor">▍</span></div>
            <div className="agent-activity">
              <div className="agent-line agent-line-one"><span>✓</span> Inspecting project structure</div>
              <div className="agent-line agent-line-two"><span>✓</span> Reading existing components</div>
              <div className="agent-line agent-line-three"><span>✓</span> Mapping the user flows</div>
              <div className="agent-line agent-line-four"><span>›</span> Designing the implementation</div>
              <div className="agent-line agent-line-five"><span>›</span> Updating application code</div>
              <div className="agent-line agent-line-six"><span>›</span> Checking edge cases</div>
              <div className="agent-line agent-line-seven"><span>›</span> Running checks and tests</div>
            </div>
            <div className="agent-thinking"><span className="thinking-spinner" /> Working<span className="thinking-dots">...</span></div>
          </motion.div>}
        </AnimatePresence>
      </section>
      <div className="hero-window-bottom"><span><span className="agent-status-dot" /> {started ? 'RUNNING' : 'READY'}</span><span>~ / workspace</span></div>
    </div>
  )
}

function PhaseScreen({ phase }: { phase: Phase }) {
  if (phase === 'select') return <div className="demo-library"><div className="demo-library-heading"><strong>Arcade</strong><span>{practiceGames.length + 1} games</span></div><div className="demo-library-grid"><a href="#play" className="demo-library-tile"><GameArtwork id="rps" /><span>Rock Paper Scissors</span></a>{practiceGames.map(game => <a href={`#practice/${game.id}`} className="demo-library-tile" key={game.id}><GameArtwork id={game.id} /><span>{game.name}</span></a>)}</div></div>
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
    let timer: number
    function advance() { if (document.hidden) timer = window.setTimeout(advance, 1000); else setIndex((current) => (current + 1) % phases.length) }
    timer = window.setTimeout(advance, index === 0 ? 9000 : 3800)
    return () => clearTimeout(timer)
  }, [reduced, started, index])
  const phase = reduced ? 'select' : phases[index]
  return (
    <div className="hero-window hero-game">
      <div className="hero-window-bar"><div className="hero-window-title"><Gamepad2 size={15} /> arcade</div><span className="hero-window-badge">SIMULATED</span></div>
      <section className="game-terminal-stage" aria-label="Simulated arcade flow: choose a game, invite a friend, deposit, commit, reveal, and claim.">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div className="demo-frame" key={phase} initial={reduced ? false : { opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: -7 }} transition={{ duration: .25 }}>
            <PhaseScreen phase={phase} />
          </motion.div>
        </AnimatePresence>
      </section>
      <div className="hero-window-bottom"><span>ARCADE / {practiceGames.length + 1}</span><div className="demo-progress" aria-hidden="true">{phases.map((step, i) => <span className={i === (reduced ? 0 : index) ? 'active' : ''} key={step} />)}</div></div>
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
        <div className="hero-shell-bar"><PanelLeft size={15} /><span>Workspace</span><span>DEMO</span></div>
        <div className="desktop-workspace"><aside className="desktop-rail" aria-hidden="true"><div className="desktop-rail-heading">Workspace</div><div className="desktop-rail-new"><Plus size={15} /> New task</div><div className="desktop-rail-label">Recent</div><div className="desktop-rail-task"><Code2 size={14} /> Build a product</div><div className="desktop-rail-task"><Folder size={14} /> Improve dashboard</div><div className="desktop-rail-task"><Code2 size={14} /> Refine components</div><div className="desktop-rail-task"><Code2 size={14} /> Add project tests</div><div className="desktop-rail-settings"><Settings2 size={15} /></div></aside><div className="hero-workspace"><AgentTerminal started={started} reduced={reduced} /><GameTerminal started={started} /></div></div>
      </div>
    </section>
  )
}
