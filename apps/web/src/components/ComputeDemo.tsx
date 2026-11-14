import { ArrowRight, Coins, Cpu, Gamepad2, RotateCcw, Wallet } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { demoMoves as moves, initialDemoDuel as initial, playDemoRound } from '../lib/compute-demo'
import './compute-demo.css'

const stages = [
  { id: 'play', label: 'Play', icon: Gamepad2 },
  { id: 'claimed', label: 'Claim', icon: Wallet },
  { id: 'redeemed', label: 'Redeem', icon: Coins },
  { id: 'used', label: 'Run inference', icon: Cpu },
] as const

type Stage = (typeof stages)[number]['id']

const next: Record<Stage, { label: string; stage: Stage } | null> = {
  play: { label: 'Claim simulated payout', stage: 'claimed' },
  claimed: { label: 'Redeem 5 simulated PCC', stage: 'redeemed' },
  redeemed: { label: 'Run a mock inference request', stage: 'used' },
  used: null,
}

export function ComputeDemo() {
  const [demand, setDemand] = useState(50)
  const [duel, setDuel] = useState(initial)
  const [stage, setStage] = useState<Stage>('play')
  const stageHeading = useRef<HTMLHeadingElement>(null)
  const fundedUnits = Math.min(demand, 50)
  const won = duel.wins === 2
  const finished = won || duel.losses === 2
  const stageIndex = stages.findIndex(item => item.id === stage)
  const action = next[stage]
  const stageTitle = {
    play: finished ? (won ? 'You won the pot' : 'Computer wins the match') : 'Choose your move',
    claimed: 'Payout claimed',
    redeemed: 'Allowance ready',
    used: 'Mock request complete',
  }[stage]

  const wasPlaying = useRef(true)
  const playing = stage === 'play' && !finished
  useEffect(() => {
    if (stage !== 'play' || !playing || !wasPlaying.current) stageHeading.current?.focus()
    wasPlaying.current = playing
  }, [playing, stage])

  return (
    <section className="practice-page compute-demo" aria-labelledby="compute-demo-title">
      <a className="back-btn" href="#arcade">← Arcade</a>
      <header className="compute-demo-intro">
        <span className="practice-label">OFFLINE SIMULATION</span>
        <h1 id="compute-demo-title">Practice the compute loop</h1>
        <p>Play for simulated PCC, redeem it for allowance, then try a mock inference request. No wallet, blockchain transactions or model provider are involved.</p>
      </header>

      <ol className="compute-demo-progress" aria-label="Demo progress">
        {stages.map(({ id, label, icon: Icon }, index) => (
          <li key={id} aria-current={stage === id ? 'step' : undefined} data-done={index < stageIndex || undefined}>
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </li>
        ))}
      </ol>

      <div className="terminal-card compute-demo-board" data-stage={stage}>
        <div className="compute-demo-stage" key={stage}>
          <h2 ref={stageHeading} tabIndex={-1}>{stageTitle}</h2>
          {stage === 'play' && (
            <>
              <p>First to two wins. Each player stakes 5 simulated PCC.</p>
              <dl className="compute-demo-score">
                <div><dt>You</dt><dd>{duel.wins}</dd></div>
                <div><dt>Computer</dt><dd>{duel.losses}</dd></div>
              </dl>
              <div className="compute-demo-moves">
                {moves.map((move, choice) => (
                  <button className="btn-ghost" key={move} type="button" disabled={finished} onClick={() => setDuel(current => playDemoRound(current, choice))}>
                    <img src={`/hands/${move.toLowerCase()}.svg`} alt="" width="56" height="56" />
                    {move}
                  </button>
                ))}
              </div>
              <output className="compute-demo-round">{duel.result}</output>
              {finished && <p>{won ? 'The 10 PCC pot includes your original stake.' : 'Restart to try a different strategy.'}</p>}
            </>
          )}
          {stage === 'claimed' && <p>Both simulated stakes moved to your wallet. Use 5 PCC to fund one gateway unit.</p>}
          {stage === 'redeemed' && <p>Your simulated wallet paid 5 PCC. One gateway unit is now available to spend.</p>}
          {stage === 'used' && <p>Mock response. This example used 6 microunits.</p>}
          {stage !== 'play' && (
            <dl className="compute-demo-score">
              <div><dt>Simulated wallet</dt><dd>{stage === 'claimed' ? 10 : 5} PCC</dd></div>
              <div><dt>Simulated allowance</dt><dd>{stage === 'claimed' ? '0' : stage === 'redeemed' ? '1.000000' : '0.999994'} units</dd></div>
            </dl>
          )}
          {action && (stage !== 'play' || won) && (
            <button className="btn-primary" type="button" onClick={() => setStage(action.stage)}>
              {action.label}<ArrowRight size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="promptplay-quickstart-actions">
        <button className="btn-ghost" type="button" onClick={() => { setDuel(initial); setStage('play') }}>
          <RotateCcw size={15} aria-hidden="true" /> Restart demo
        </button>
        <a className="btn-ghost" href="#play">Open Testnet duel <ArrowRight size={16} aria-hidden="true" /></a>
      </div>

      <details className="compute-demo-demand">
        <summary>Simulate redemption demand</summary>
        <p>Assume 500 PCC in players’ wallets, a fixed 5 PCC per unit, and 50 remaining funded gateway units.</p>
        <label className="field-label">
          <span>Requested units: {demand}</span>
          <input type="range" min="0" max="100" value={demand} onChange={event => setDemand(Number(event.target.value))} />
        </label>
        <output>{fundedUnits} units funded · {fundedUnits * 5} PCC transferred · {50 - fundedUnits} units left · {demand - fundedUnits} requests unmet</output>
      </details>
    </section>
  )
}
