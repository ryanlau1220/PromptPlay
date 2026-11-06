import { ArrowDown, ArrowRight, Cpu, Gamepad2, TerminalSquare } from 'lucide-react'

export function ArcadeScene() {
  return (
    <section className="arcade-hero" aria-label="PromptPlay arcade">
      <h1 className="visually-hidden">PromptPlay arcade</h1>
      <div className="terminal-window">
        <div className="terminal-titlebar">
          <div className="terminal-lights" aria-hidden="true"><i /><i /><i /></div>
          <div className="terminal-title"><TerminalSquare size={15} /> promptplay <span>/</span> arcade</div>
          <span className="terminal-demo">DEMO</span>
        </div>
        <div className="terminal-body">
          <div className="terminal-code" aria-label="Illustrative agent terminal animation">
            <div className="terminal-row terminal-row-one"><span className="terminal-prompt">~ ❯</span> opencode run <span className="terminal-string">"build the feature"</span></div>
            <div className="terminal-row terminal-row-two"><span className="terminal-muted">⠋</span> agent is working<span className="terminal-muted">...</span></div>
            <div className="terminal-row terminal-row-three"><span className="terminal-check">✓</span> <span className="terminal-muted">workspace ready</span></div>
            <div className="terminal-row terminal-row-four"><span className="terminal-prompt">~ ❯</span> promptplay <span className="terminal-string">arcade</span><span className="terminal-cursor">▊</span></div>
          </div>
          <div className="terminal-divider" />
          <div className="terminal-arcade" aria-label="Arcade preview">
            <div className="terminal-arcade-heading"><span>ARCADE</span><span>01 <i>/</i> 01</span></div>
            <div className="terminal-game-row">
              <div className="terminal-game-art" aria-hidden="true">
                <span className="terminal-game-orbit terminal-game-orbit-one" />
                <span className="terminal-game-orbit terminal-game-orbit-two" />
                <span className="terminal-game-center"><Gamepad2 size={34} strokeWidth={1.5} /></span>
                <span className="terminal-pixel terminal-pixel-one" /><span className="terminal-pixel terminal-pixel-two" /><span className="terminal-pixel terminal-pixel-three" />
              </div>
              <div className="terminal-game-info"><span>2 PLAYER <b>·</b> TESTNET</span><strong>Rock Paper Scissors</strong><span>PLAY WITH PCC</span></div>
              <a href="#play" className="terminal-play" aria-label="Play Rock Paper Scissors"><ArrowRight size={20} /></a>
            </div>
          </div>
        </div>
        <div className="terminal-footer">
          <a href="#play"><Gamepad2 size={16} /> Play <ArrowRight size={15} /></a>
          <a href="#redeem"><Cpu size={16} /> Compute <ArrowRight size={15} /></a>
          <a className="terminal-explore" href="#loop" aria-label="Explore PromptPlay"><ArrowDown size={18} /></a>
        </div>
      </div>
    </section>
  )
}
