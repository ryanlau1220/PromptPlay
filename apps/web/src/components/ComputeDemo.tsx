import { useState } from 'react'
import { demoMoves as moves, initialDemoDuel as initial, playDemoRound } from '../lib/compute-demo'

export function ComputeDemo() {
  const [demand, setDemand] = useState(50)
  const fundedUnits = Math.min(demand, 50)
  const [duel, setDuel] = useState(initial)
  const [stage, setStage] = useState<'play' | 'claimed' | 'redeemed' | 'used'>('play')
  const won = duel.wins === 2
  const finished = won || duel.losses === 2

  function play(choice: number) {
    setDuel(current => playDemoRound(current, choice))
  }

  return (
    <section className="practice-page" aria-labelledby="compute-demo-title">
      <a className="back-btn" href="#arcade">← Arcade</a>
      <h1 id="compute-demo-title">Practice the compute loop</h1>
      <p>Offline simulation. Play first to two wins against a rule-based computer. Each player stakes 5 simulated PCC.</p>
      <p>This demo uses no wallet, blockchain transactions or model provider.</p>
      <div className="terminal-card">
        <p>You {duel.wins} · Computer {duel.losses}</p>
        <div className="promptplay-quickstart-actions">
          {moves.map((move, choice) => (
            <button className="btn-ghost" key={move} type="button" disabled={finished} onClick={() => play(choice)}>{move}</button>
          ))}
        </div>
        <output>{duel.result}</output>
        {finished && (
          <p>{won ? 'You won the 10 PCC simulated pot, including your original stake.' : 'The computer won the simulated pot. Restart to try a different strategy.'}</p>
        )}
        {won && stage === 'play' && <button className="btn-primary" type="button" onClick={() => setStage('claimed')}>Claim simulated payout</button>}
        {stage === 'claimed' && <button className="btn-primary" type="button" onClick={() => setStage('redeemed')}>Redeem 5 simulated PCC</button>}
        {stage === 'redeemed' && <button className="btn-primary" type="button" onClick={() => setStage('used')}>Run a mock inference request</button>}
        {stage !== 'play' && <p>Simulated wallet · {stage === 'claimed' ? 10 : 5} PCC</p>}
        {(stage === 'redeemed' || stage === 'used') && <p>Simulated allowance · {stage === 'redeemed' ? '1.000000' : '0.999994'} units</p>}
        {stage === 'used' && <output>Mock response. This example used 6 microunits.</output>}
      </div>
      <div className="promptplay-quickstart-actions">
        <button className="btn-ghost" type="button" onClick={() => { setDuel(initial); setStage('play') }}>Restart demo</button>
        <a className="btn-ghost" href="#play">Open Testnet duel</a>
      </div>
      <details>
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
