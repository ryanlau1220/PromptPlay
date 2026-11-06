import { useState, useEffect } from 'react'
import type React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  Gamepad2,
  ShieldCheck,
  ArrowRight,
  Lock,
  Code2,
  Terminal,
  Layers,
  Coins
} from 'lucide-react'
import { GAME, base64, commitment } from '../lib/game'
import { useSession } from './Session'
import { ArcadeScene } from './ArcadeScene'
import { practiceGames } from './practice/games'

// ─── Timing constants ──────────────────────────────────────────────────────
const TIMING = {
  kicker:    100,
  title:     220,
  cta:       380,
  cabinet:   500,
  loop:      900,
  cards:    1100,
  sandbox:  1400,
  rest:     1700,
} as const

// ─── Spring presets ────────────────────────────────────────────────────────
const SPRING = {
  bouncy:  { type: 'spring' as const, stiffness: 280, damping: 26 },
  smooth:  { type: 'spring' as const, stiffness: 300, damping: 30 },
  stiff:   { type: 'spring' as const, stiffness: 350, damping: 28 },
  snappy:  { type: 'spring' as const, stiffness: 400, damping: 30 },
} as const

// ─── Section motion wrapper ────────────────────────────────────────────────
function FadeUp({
  show,
  offsetY = 20,
  spring = SPRING.smooth,
  children,
  style,
}: {
  show: boolean
  offsetY?: number
  spring?: typeof SPRING[keyof typeof SPRING]
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: offsetY }}
      animate={{ opacity: show ? 1 : 0, y: show ? 0 : offsetY }}
      transition={spring}
      style={style}
    >
      {children}
    </motion.div>
  )
}

// ─── Staggered list item ───────────────────────────────────────────────────
function StaggerItem({
  show,
  index,
  stagger = 0.1,
  children,
  className,
  style,
}: {
  show: boolean
  index: number
  stagger?: number
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: show ? 1 : 0, y: show ? 0 : 16 }}
      transition={{ ...SPRING.bouncy, delay: show ? index * stagger : 0 }}
    >
      {children}
    </motion.div>
  )
}

export function ArcadeLobby() {
  const reduced = useReducedMotion()
  const { config } = useSession()
  useEffect(() => { if (window.location.hash === '#games') requestAnimationFrame(() => document.getElementById('games')?.scrollIntoView()) }, [])
  const [stage, setStage] = useState(reduced ? 99 : 0)
  const [simulatedChoice, setSimulatedChoice] = useState<number>(0)
  const choices = [
    { id: 0, name: 'Rock', icon: '/hands/rock.svg' },
    { id: 1, name: 'Paper', icon: '/hands/paper.svg' },
    { id: 2, name: 'Scissors', icon: '/hands/scissors.svg' },
  ]
  const [example, setExample] = useState<{ salt: string; hash: string } | null>(null)
  useEffect(() => {
    let active = true
    const secret = crypto.getRandomValues(new Uint8Array(32))
    setExample(null)
    void commitment('example.testnet', '0', simulatedChoice, secret).then((hash) => {
      if (active) setExample({ salt: base64(secret), hash })
    })
    return () => { active = false }
  }, [simulatedChoice])

  // Page entrance cascade
  useEffect(() => {
    if (reduced) return
    const timers: ReturnType<typeof setTimeout>[] = []
    timers.push(setTimeout(() => setStage(1), TIMING.kicker))
    timers.push(setTimeout(() => setStage(2), TIMING.title))
    timers.push(setTimeout(() => setStage(3), TIMING.cta))
    timers.push(setTimeout(() => setStage(4), TIMING.cabinet))
    timers.push(setTimeout(() => setStage(6), TIMING.loop))
    timers.push(setTimeout(() => setStage(7), TIMING.cards))
    timers.push(setTimeout(() => setStage(8), TIMING.sandbox))
    timers.push(setTimeout(() => setStage(9), TIMING.rest))
    return () => timers.forEach(clearTimeout)
  }, [reduced])

  return (
    <div className="lobby-container">

      <ArcadeScene />

      {/* ── FEATURED GAME ─────────────────────────────────────────────── */}
      <section id="games" className="games-showcase" aria-labelledby="games-title">
        <FadeUp show={stage >= 9} offsetY={20} spring={SPRING.smooth}>
          <div className="section-heading-row">
            <div>
              <div className="section-kicker">
                <Gamepad2 size={14} />
                <span>ARCADE CATALOG // 11</span>
              </div>
              <h2 id="games-title" className="section-title">Games</h2>
            </div>
          </div>

          <div className="game-showcase-card">
            <div className="game-showcase-media">
              <div className="hands-cluster">
                <span style={{ background: '#00f0ff' }}>
                  <img src="/hands/rock.svg" alt="" style={{ width: '60%' }} />
                </span>
                <span style={{ background: '#ff2a6d' }}>
                  <img src="/hands/paper.svg" alt="" style={{ width: '60%' }} />
                </span>
                <span style={{ background: '#ffb800' }}>
                  <img src="/hands/scissors.svg" alt="" style={{ width: '60%' }} />
                </span>
              </div>
            </div>

            <div className="game-showcase-info">
              <div>
                <span className="hero-pill">2 PLAYERS · ON-CHAIN ESCROW</span>
                <h3>Rock Paper Scissors Blitz</h3>

                <div className="game-specs-grid">
                  <div className="spec-item">
                    <span>Match Stake</span>
                    <strong>Your choice</strong>
                  </div>
                  <div className="spec-item">
                    <span>Phase Timeout</span>
                    <strong>5 min / phase</strong>
                  </div>
                  <div className="spec-item">
                    <span>Payout Target</span>
                    <strong>2× stake</strong>
                  </div>
                </div>
              </div>

              <a href="#play" className="btn-primary" style={{ alignSelf: 'flex-start' }}>
                <Gamepad2 size={16} />
                <span>Launch Match</span>
                <ArrowRight size={14} />
              </a>
            </div>
          </div>
          <div className="practice-catalog-heading"><h3>Practice games</h3><span>NO WALLET · NO PCC</span></div>
          <div className="practice-catalog">
            {practiceGames.map((game, index) => <a href={`#practice/${game.id}`} className="practice-entry" key={game.id}><span className="practice-entry-icon" aria-hidden="true">{game.icon}</span><span className="practice-entry-title"><strong>{game.name}</strong><small>{game.kind}</small></span><span className="practice-entry-number">{String(index + 2).padStart(2, '0')}</span><ArrowRight size={16} /></a>)}
          </div>
        </FadeUp>
      </section>

      {/* ── COMPUTE LOOP SECTION ──────────────────────────────────────── */}
      <section id="loop" className="story-section" aria-labelledby="story-title">
        <FadeUp show={stage >= 6} offsetY={20} spring={SPRING.smooth}>
          <div className="section-kicker">
            <Layers size={14} />
            <span>CIRCULAR COMPUTE ECONOMY</span>
          </div>

          <div className="section-heading-row">
            <div>
              <h2 id="story-title" className="section-title">The Compute Loop</h2>
            </div>
            <a href={`https://testnet.nearblocks.io/address/${GAME}`} target="_blank" rel="noreferrer" className="arena-contract-link">
              <span>Verified Game Contract ↗</span>
            </a>
          </div>
        </FadeUp>

        <div className="story-grid">
          {[
            { num: '01', accent: 'var(--cyan)', icon: <Coins size={24} />, title: 'Stake & Escrow', metric: '5.0 PCC ➔ On-Chain Vault', detail: 'ft_transfer_call · Non-custodial' },
            { num: '02', accent: 'var(--crimson)', icon: <Lock size={24} />, title: 'Commit & Reveal', metric: 'SHA-256 (Secret + Move)', detail: '32-Byte Client Salt' },
            { num: '03', accent: 'var(--amber)', icon: <Terminal size={24} />, title: 'Fuel Your Agent', metric: 'PCC ➔ Gateway Units', detail: config?.redemptionAvailable ? 'Redemption enabled' : 'Redemption currently gated' },
          ].map((card, i) => (
            <StaggerItem key={card.num} show={stage >= 7} index={i} stagger={0.12}>
              <div className="story-card" style={{ '--card-accent': card.accent } as React.CSSProperties}>
                <div className="story-card-number">{card.num}</div>
                <div className="story-icon-box" style={{ color: card.accent }}>{card.icon}</div>
                <h3>{card.title}</h3>
                <div className="story-metric">{card.metric}</div>
                <span className="story-card-detail">{card.detail}</span>
              </div>
            </StaggerItem>
          ))}
        </div>

        {/* ── INTERACTIVE SANDBOX ───────────────────────────────────── */}
        <FadeUp show={stage >= 8} offsetY={20} spring={SPRING.smooth} style={{ marginTop: '48px' }}>
          <div className="sandbox-card">
            <div className="sandbox-header">
              <div>
                <span className="section-kicker" style={{ color: 'var(--amber)' }}>
                  <Code2 size={14} />
                  <span>CRYPTOGRAPHIC MOVE COMMITMENT</span>
                </span>
                <h4>On-Device Move Hasher</h4>
              </div>
              <span className="story-card-detail">Example · account example.testnet · match 0</span>
            </div>

            <div className="sandbox-selector">
              {choices.map((choice) => (
                <motion.button
                  key={choice.id}
                  type="button"
                  className={`sandbox-move-btn ${simulatedChoice === choice.id ? 'active' : ''}`}
                  onClick={() => setSimulatedChoice(choice.id)}
                  whileHover={{ y: -4, scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  transition={SPRING.snappy}
                >
                  <img src={choice.icon} alt="" />
                  <span>{choice.name}</span>
                </motion.button>
              ))}
            </div>

            <div className="sandbox-code-preview">
              <div>Move: <strong>{choices[simulatedChoice]?.name.toUpperCase()}</strong></div>
              <div>Salt: <span style={{ color: 'var(--text)' }}>{example?.salt ?? 'Computing…'}</span></div>
              <div>Commit: <strong>{example?.hash ?? 'Computing…'}</strong></div>
            </div>
          </div>
        </FadeUp>
      </section>

      {/* ── AGENT COMPATIBILITY ───────────────────────────────────────── */}
      <section className="agents-section" aria-labelledby="agents-title">
        <FadeUp show={stage >= 9} offsetY={16} spring={SPRING.smooth}>
          <div className="section-kicker">
            <Code2 size={14} />
            <span>TOOL COMPATIBILITY</span>
          </div>
          <h2 id="agents-title" className="section-title">Drop-in Gateway Support</h2>

          <div className="agent-chips-row">
            {['OpenCode', 'Pi Agent'].map((name, i) => (
              <motion.div
                key={name}
                className="agent-badge-chip"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: stage >= 9 ? 1 : 0, x: stage >= 9 ? 0 : -12 }}
                transition={{ ...SPRING.snappy, delay: stage >= 9 ? 0.05 + i * 0.06 : 0 }}
              >
                <span className="chip-dot" />
                <span>{name}</span>
              </motion.div>
            ))}
          </div>
        </FadeUp>
      </section>

      {/* ── PROTOCOL STATUS ───────────────────────────────────────────── */}
      <section className="status-section" aria-labelledby="status-title">
        <FadeUp show={stage >= 9} offsetY={16} spring={SPRING.smooth}>
          <div className="section-heading-row">
            <div>
              <div className="section-kicker">
                <ShieldCheck size={14} />
                <span>PROTOCOL STATUS</span>
              </div>
              <h2 id="status-title" className="section-title">Project status</h2>
            </div>
          </div>

          <div className="status-cols">
            <div className="status-col">
              <div className="status-col-header status-live-header">
                <span className="status-dot status-dot-live" />
                <span>Available &amp; tested</span>
              </div>
              <ul className="status-list">
                {[
                  ['Two-Player RPS · Commit-Reveal', 'On-chain escrow, non-custodial'],
                  ['PCC NEP-141 Token + Faucet', config?.faucetAvailable ? 'Testnet faucet enabled' : 'Testnet faucet currently disabled'],
                  ['Inference Gateway', config?.redemptionAvailable ? 'Redemption enabled' : 'Operator-only test; redemption gated'],
                  ['OpenAI-Compatible API', '/v1/chat/completions · per-user keys'],
                  ['Real-Time WebSocket Sync', 'Match phase & state updates'],
                ].map(([title, sub], i) => (
                  <motion.li
                    key={title}
                    className="status-item"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: stage >= 9 ? 1 : 0, x: stage >= 9 ? 0 : -10 }}
                    transition={{ ...SPRING.snappy, delay: stage >= 9 ? 0.1 + i * 0.07 : 0 }}
                  >
                    <span className="status-badge status-badge-live">✓</span>
                    <div>
                      <div className="status-item-title">{title}</div>
                      <div className="status-item-sub">{sub}</div>
                    </div>
                  </motion.li>
                ))}
              </ul>
            </div>

            <div className="status-col">
              <div className="status-col-header status-next-header">
                <span className="status-dot status-dot-next" />
                <span>Coming Next</span>
              </div>
              <ul className="status-list">
                {[
                  ['Best-of-Two-Wins Rounds', 'Multi-round match structure'],
                  ['Match History Projection', 'On-chain event replay & stats'],
                  ['Agent-Finished Notifications', 'Browser push when match resolves'],
                  ['NEP-297 Contract Events', 'Structured on-chain event log'],
                ].map(([title, sub], i) => (
                  <motion.li
                    key={title}
                    className="status-item"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: stage >= 9 ? 1 : 0, x: stage >= 9 ? 0 : 10 }}
                    transition={{ ...SPRING.snappy, delay: stage >= 9 ? 0.1 + i * 0.07 : 0 }}
                  >
                    <span className="status-badge status-badge-next">→</span>
                    <div>
                      <div className="status-item-title">{title}</div>
                      <div className="status-item-sub">{sub}</div>
                    </div>
                  </motion.li>
                ))}
              </ul>
            </div>
          </div>
        </FadeUp>
      </section>
    </div>
  )
}
