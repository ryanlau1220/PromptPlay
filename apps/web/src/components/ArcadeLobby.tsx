import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUpRight, ChevronLeft, ChevronRight, Coins, Cpu, Gamepad2, Lock } from 'lucide-react'
import { GAME, TOKEN, base64, commitment } from '../lib/game'
import { ArcadeScene } from './ArcadeScene'
import { useSession } from './Session'
import { GameArtwork } from './practice/GameArtwork'
import { practiceGames } from './practice/games'
import './arcade-story.css'

const choices = [
  { name: 'Rock', icon: '/hands/rock.svg' },
  { name: 'Paper', icon: '/hands/paper.svg' },
  { name: 'Scissors', icon: '/hands/scissors.svg' },
]

const steps = [
  { title: 'Play a duel', label: 'NEAR Testnet', icon: Gamepad2, detail: 'Both players stake PCC. A secret commitment keeps each move hidden until both players are ready to reveal.' },
  { title: 'Claim the pot', label: 'Verified payout', icon: Coins, detail: 'Win two rounds to claim both stakes, including your own. The game contract verifies the result and pays the winner.' },
  { title: 'Run inference', label: '5 PCC per gateway unit', icon: Cpu, detail: 'Eligible wallets can redeem PCC into operator-funded allowance for the playground or a compatible coding agent.' },
]

export function ArcadeLobby() {
  const { config, configStatus } = useSession()
  const intro = useRef<HTMLElement>(null)
  const gallery = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [example, setExample] = useState<{ salt: string; hash: string } | null>(null)
  const [hashError, setHashError] = useState(false)

  useEffect(() => {
    function scrollToSection() {
      const id = window.location.hash.slice(1)
      if (id === 'games' || id === 'loop') document.getElementById(id)?.scrollIntoView()
    }
    const frame = requestAnimationFrame(scrollToSection)
    window.addEventListener('hashchange', scrollToSection)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('hashchange', scrollToSection)
    }
  }, [])

  function scrollGames(direction: number) {
    const rail = gallery.current
    if (!rail) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    rail.scrollBy({ left: direction * rail.clientWidth * 0.8, behavior: reduced ? 'instant' : 'smooth' })
  }

  function showCommitment(choice: number) {
    if (choice === selected) return
    setSelected(choice)
    setExample(null)
    setHashError(false)
  }

  useEffect(() => {
    if (selected === null) return
    let active = true
    const salt = crypto.getRandomValues(new Uint8Array(32))
    void commitment('example.testnet', '0', 1, selected, salt)
      .then(hash => { if (active) setExample({ salt: base64(salt), hash }) })
      .catch(() => { if (active) setHashError(true) })
    return () => { active = false }
  }, [selected])

  return (
    <div className="lobby-container arcade-story">
      <section
        ref={intro}
        className="story-intro"
        aria-labelledby="quickstart-title"
        onPointerMove={event => {
          if (event.pointerType !== 'mouse' || !intro.current ||
              window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
          const rect = event.currentTarget.getBoundingClientRect()
          intro.current.style.setProperty('--story-light-x', `${event.clientX - rect.left}px`)
          intro.current.style.setProperty('--story-light-y', `${event.clientY - rect.top}px`)
        }}
        onPointerLeave={() => {
          intro.current?.style.removeProperty('--story-light-x')
          intro.current?.style.removeProperty('--story-light-y')
        }}
      >
        <div className="story-intro-copy">
          <h1 id="quickstart-title">
            <span>Play while your </span>
            <span>coding agent runs.</span>
          </h1>
          <p>Take a break with a quick game, or stake PromptPlay Compute Credits (PCC) in a Testnet duel. Redeem eligible credits to run AI inference.</p>
          <div className="promptplay-quickstart-actions">
            <a className="btn-primary" href="#compute-demo">Play the wallet-free demo <ArrowUpRight size={17} aria-hidden="true" /></a>
            <a className="btn-ghost" href="#play">Start a Testnet duel</a>
          </div>
          <a className="story-down" href="#loop">See how it works <ArrowDown size={15} aria-hidden="true" /></a>
        </div>
        <div className="story-preview">
          <ArcadeScene />
        </div>
      </section>

      <section id="loop" className="story-section story-loop" aria-labelledby="story-title">
        <div className="section-heading-row">
          <h2 id="story-title" className="section-title">From game to compute</h2>
          <a href={`https://testnet.nearblocks.io/address/${GAME}`} target="_blank" rel="noreferrer" className="arena-contract-link">Inspect the Testnet game contract ↗</a>
        </div>
        <ol className="story-steps">
          {steps.map(({ title, label, detail, icon: Icon }) => (
            <li key={title} className="story-step">
              <Icon size={26} aria-hidden="true" />
              <h3>{title}</h3>
              <strong>{label}</strong>
              <p>{detail}</p>
            </li>
          ))}
        </ol>

        <details className="story-commit">
          <summary><Lock size={17} aria-hidden="true" /> Try a move commitment</summary>
          <p>Pick a move to generate a SHA-256 commitment in your browser. The example uses round 1 of match 0 and a fresh 32-byte secret whenever you select a different move.</p>
          <div className="sandbox-selector">
            {choices.map((choice, index) => (
              <button key={choice.name} type="button" className={`sandbox-move-btn ${selected === index ? 'active' : ''}`} aria-pressed={selected === index} onClick={() => showCommitment(index)}>
                <img src={choice.icon} alt="" />
                <span>{choice.name}</span>
              </button>
            ))}
          </div>
          {selected !== null && (
            <output className="sandbox-code-preview">
              {hashError ? 'Could not calculate the commitment in this browser.' : example ? (
                <>
                  <div>Secret: {example.salt}</div>
                  <div>Commitment: <strong>{example.hash}</strong></div>
                </>
              ) : 'Calculating commitment…'}
            </output>
          )}
        </details>
      </section>

      <section id="games" className="games-showcase story-games" aria-labelledby="games-title">
        <div className="section-heading-row">
          <div>
            <h2 id="games-title" className="section-title">Choose a game</h2>
            <p>Practice games run locally and award no PCC.</p>
          </div>
          <div className="story-gallery-controls">
            <button type="button" className="btn-ghost" aria-label="Previous games" aria-controls="story-game-gallery" onClick={() => scrollGames(-1)}><ChevronLeft size={20} /></button>
            <button type="button" className="btn-ghost" aria-label="Next games" aria-controls="story-game-gallery" onClick={() => scrollGames(1)}><ChevronRight size={20} /></button>
          </div>
        </div>
        <div className="games-grid" id="story-game-gallery" ref={gallery}>
          <a href="#play" className="game-tile game-tile-featured"><GameArtwork id="rps" /><span><strong>Rock Paper Scissors</strong><small>TESTNET · 2 PLAYERS</small></span></a>
          {practiceGames.map(game => <a href={`#practice/${game.id}`} className="game-tile" key={game.id}><GameArtwork id={game.id} /><span><strong>{game.name}</strong><small>{game.kind}</small></span></a>)}
        </div>
      </section>

      <section className="story-gateway" aria-labelledby="agents-title">
        <div>
          <h2 id="agents-title" className="section-title">Use your compute allowance</h2>
          <p>Try the inference playground or connect OpenCode or Pi through the OpenAI-compatible gateway.</p>
          <p>{configStatus === 'loading' ? 'Checking gateway availability…' : config?.redemptionAvailable ? 'Live redemption is enabled for eligible wallets.' : configStatus === 'unavailable' ? 'The gateway status is currently unavailable.' : 'Live redemption is currently disabled.'}</p>
        </div>
        <div className="promptplay-quickstart-actions">
          <a className="btn-primary" href="#redeem">Open Inference Hub</a>
          <a className="btn-ghost" href={`https://testnet.nearblocks.io/address/${TOKEN}`} target="_blank" rel="noreferrer">View PCC on Testnet ↗</a>
        </div>
      </section>
    </div>
  )
}
