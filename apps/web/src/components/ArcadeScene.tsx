import { ArrowDown, Cpu, Gamepad2 } from 'lucide-react'

function TerminalScreen({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`scene-terminal${compact ? ' scene-terminal-mobile' : ''}`} aria-hidden="true">
      <div className="scene-terminal-bar"><span /><span /><span /><b>agent / demo</b></div>
      <div className="scene-terminal-lines">
        <div className="scene-line scene-line-one"><i>$</i> opencode run <em>"build the feature"</em></div>
        <div className="scene-line scene-line-two"><i>›</i> reading project files<span className="scene-dots">...</span></div>
        <div className="scene-line scene-line-three"><i>✓</i> agent working in background</div>
        <div className="scene-line scene-line-four"><i>$</i> promptplay arcade <span className="scene-cursor">▮</span></div>
      </div>
    </div>
  )
}

export function ArcadeScene() {
  return (
    <section className="arcade-hero" aria-label="PromptPlay developer arcade">
      <h1 className="visually-hidden">PromptPlay developer arcade</h1>
      <div className="workspace-scene" role="img" aria-label="An animated developer workstation with a coding agent and an arcade machine. Terminal activity is illustrative.">
        <svg viewBox="0 0 1200 660" aria-hidden="true" className="workspace-art">
          <defs>
            <linearGradient id="workspace-desk" x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--scene-desk-top)" /><stop offset="1" stopColor="var(--scene-desk-side)" /></linearGradient>
            <linearGradient id="workspace-cabinet" x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--scene-cab-top)" /><stop offset="1" stopColor="var(--scene-cab-side)" /></linearGradient>
            <radialGradient id="workspace-glow"><stop stopColor="var(--cyan)" stopOpacity=".18" /><stop offset="1" stopColor="var(--cyan)" stopOpacity="0" /></radialGradient>
            <pattern id="workspace-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="var(--scene-grid)" strokeWidth="1" /></pattern>
          </defs>
          <rect x="35" y="28" width="1130" height="560" rx="34" fill="url(#workspace-grid)" opacity=".5" />
          <ellipse cx="620" cy="350" rx="510" ry="280" fill="url(#workspace-glow)" />
          <path d="M130 538L440 404H905L1080 532 763 628H376Z" fill="var(--scene-floor)" stroke="var(--scene-outline)" strokeWidth="3" />
          <path d="M168 548L401 448M252 578L486 450M812 598L1007 534M736 617L968 521" fill="none" stroke="var(--scene-grid)" strokeWidth="2" />
          {/* Far wall details */}
          <path d="M120 123v185M121 123h206M995 118v189" fill="none" stroke="var(--scene-grid)" strokeWidth="3" />
          <circle cx="127" cy="132" r="5" fill="var(--crimson)" /><circle cx="153" cy="132" r="5" fill="var(--cyan)" /><circle cx="179" cy="132" r="5" fill="var(--amber)" />
          {/* Desk and supports */}
          <path d="M209 420L777 420 864 468 291 468Z" fill="url(#workspace-desk)" stroke="var(--scene-outline)" strokeWidth="4" />
          <path d="M291 468H864v20H291Z" fill="var(--scene-desk-side)" stroke="var(--scene-outline)" strokeWidth="3" />
          <path d="M310 487h24v102h-24zm508 0h24v102h-24z" fill="var(--scene-desk-side)" />
          {/* Main agent monitor */}
          <path d="M287 184Q287 169 302 169H636Q651 169 651 184V389Q651 404 636 404H302Q287 404 287 389Z" fill="var(--scene-device)" stroke="var(--scene-outline)" strokeWidth="5" />
          <rect x="301" y="183" width="336" height="205" rx="7" fill="var(--scene-screen)" />
          <path d="M455 404v18h-45v8h122v-8h-45v-18" fill="var(--scene-outline)" />
          <foreignObject x="301" y="183" width="336" height="205"><TerminalScreen /></foreignObject>
          {/* Small secondary screen */}
          <path d="M672 238l108 16v148l-108-13z" fill="var(--scene-device)" stroke="var(--scene-outline)" strokeWidth="5" strokeLinejoin="round" />
          <path d="M685 253l82 12v119l-82-10z" fill="var(--scene-screen)" />
          <g className="scene-monitor-bars" fill="var(--cyan)"><rect x="697" y="275" width="48" height="4" rx="2" /><rect x="697" y="289" width="33" height="4" rx="2" opacity=".5" /><rect x="697" y="303" width="53" height="4" rx="2" /><rect x="697" y="317" width="40" height="4" rx="2" opacity=".5" /><rect x="697" y="331" width="28" height="4" rx="2" /></g>
          {/* Arcade cabinet, distinct from the removed intro */}
          <g className="scene-arcade">
            <path d="M868 176l148 22v226l-34 21-128-13V303l14-27z" fill="url(#workspace-cabinet)" stroke="var(--scene-outline)" strokeWidth="5" strokeLinejoin="round" />
            <path d="M868 176l27-16 148 23-27 15z" fill="var(--scene-cab-top)" stroke="var(--scene-outline)" strokeWidth="4" />
            <path d="M1016 198l27-15v225l-27 16z" fill="var(--scene-cab-side)" stroke="var(--scene-outline)" strokeWidth="4" />
            <path d="M881 208l119 17v91l-119-15z" fill="var(--scene-screen)" stroke="var(--cyan)" strokeWidth="3" />
            <g className="scene-game-pieces"><rect x="898" y="242" width="17" height="17" rx="4" fill="var(--cyan)" /><rect x="925" y="257" width="17" height="17" rx="4" fill="var(--crimson)" /><rect x="952" y="241" width="17" height="17" rx="4" fill="var(--amber)" /></g>
            <path d="M861 330l135 16 21 36-153-15z" fill="var(--scene-device)" stroke="var(--scene-outline)" strokeWidth="4" />
            <ellipse cx="913" cy="348" rx="13" ry="5" fill="var(--scene-outline)" /><path d="M913 346v-16" stroke="var(--scene-outline)" strokeWidth="5" /><circle cx="913" cy="328" r="7" fill="var(--crimson)" />
            <ellipse cx="952" cy="356" rx="8" ry="5" fill="var(--cyan)" /><ellipse cx="975" cy="358" rx="8" ry="5" fill="var(--amber)" />
            <path d="M882 391l89 10" stroke="var(--scene-grid)" strokeWidth="5" strokeLinecap="round" />
          </g>
          {/* Keyboard, cup and desk details */}
          <path d="M422 430h190l34 24H450Z" fill="var(--scene-device)" stroke="var(--scene-outline)" strokeWidth="3" />
          <g stroke="var(--scene-grid)" strokeWidth="3"><path d="M451 438h155M462 445h150M474 451h144" /><path d="M480 435l17 17m18-17 17 17m18-17 17 17m18-17 17 17" /></g>
          <path d="M742 398h32l-4 32h-24z" fill="var(--scene-device)" stroke="var(--scene-outline)" strokeWidth="3" /><path d="M774 405q18 0 9 16h-12" fill="none" stroke="var(--scene-outline)" strokeWidth="3" />
          {/* Developer, sitting at the desk */}
          <path d="M171 482q-9-48 32-55h85q29 0 30 34v91q-2 22-21 26H182q-15-3-15-19z" fill="var(--scene-chair)" stroke="var(--scene-outline)" strokeWidth="5" />
          <path d="M201 557v43m76-43v43M174 604h129" stroke="var(--scene-outline)" strokeWidth="8" strokeLinecap="round" />
          <path d="M235 417q17-49 68-59 47-4 72 28l39 49-38 30-44-35-8 99H218z" fill="var(--scene-shirt)" stroke="var(--scene-outline)" strokeWidth="5" strokeLinejoin="round" />
          <g className="scene-typing-arm">
          <path d="M352 391q21 5 41 26l32 26 42-3 4 15-55 10q-9 0-17-7l-39-25" fill="var(--scene-shirt)" stroke="var(--scene-outline)" strokeWidth="5" strokeLinejoin="round" />
          <path d="M463 440q21-5 28 4l-7 10-15 1z" fill="var(--scene-skin)" stroke="var(--scene-outline)" strokeWidth="3" />
          </g>
          <path d="M260 303q0-48 44-48 46 2 46 48v30q-6 31-36 36-37 0-48-27z" fill="var(--scene-skin)" stroke="var(--scene-outline)" strokeWidth="5" />
          <path d="M258 305q-8-50 29-61 22-22 51-3 28 7 18 55l-20-9q-12 11-27 6-15 13-45 5z" fill="var(--scene-hair)" stroke="var(--scene-outline)" strokeWidth="5" />
          <path d="M264 303q0-48 39-50 39-2 44 47" fill="none" stroke="var(--cyan)" strokeWidth="7" strokeLinecap="round" />
          <rect x="254" y="295" width="19" height="35" rx="9" fill="var(--scene-device)" stroke="var(--cyan)" strokeWidth="4" /><rect x="342" y="294" width="17" height="33" rx="8" fill="var(--scene-device)" stroke="var(--cyan)" strokeWidth="4" />
          {/* Floating agent indicators */}
          <g className="scene-orb scene-orb-one"><circle cx="236" cy="218" r="23" fill="var(--scene-device)" stroke="var(--cyan)" strokeWidth="3" /><circle cx="229" cy="216" r="3" fill="var(--cyan)" /><circle cx="243" cy="216" r="3" fill="var(--cyan)" /><path d="M229 226q7 6 14 0" fill="none" stroke="var(--cyan)" strokeWidth="2" /></g>
          <g className="scene-orb scene-orb-two"><circle cx="706" cy="159" r="19" fill="var(--scene-device)" stroke="var(--crimson)" strokeWidth="3" /><path d="M698 159h4m8 0h4m-15 8q7 5 14 0" fill="none" stroke="var(--crimson)" strokeWidth="3" strokeLinecap="round" /></g>
          <g className="scene-credit-signal"><circle cx="816" cy="252" r="6" fill="var(--amber)" /><circle cx="833" cy="237" r="3" fill="var(--amber)" /></g>
        </svg>
      </div>
      <TerminalScreen compact />
      <div className="arcade-hero-controls">
        <a className="btn-primary" href="#play"><Gamepad2 size={17} /> Play</a>
        <a className="btn-ghost" href="#redeem"><Cpu size={17} /> Compute</a>
        <a className="scene-scroll" href="#loop" aria-label="Explore PromptPlay"><ArrowDown size={18} /></a>
      </div>
    </section>
  )
}
