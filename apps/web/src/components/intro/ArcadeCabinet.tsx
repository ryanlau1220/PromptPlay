/**
 * Front view of the PromptPlay cabinet, drawn in a 400×720 viewBox.
 * The CRT glass (x 82, y 132, 236×177) and the coin slit (centre 200, 551)
 * are overlaid with HTML by the intro; keep `SCREEN_BOX` and `SLOT_POINT` in sync.
 */

export const VIEW = { w: 400, h: 720 }
export const SCREEN_BOX = { x: 82, y: 132, w: 236, h: 177 }
export const SLOT_POINT = { x: 200, y: 551 }

export function ArcadeCabinet() {
  return (
    <svg className="cab-svg" viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} aria-hidden="true">
      <defs>
        <linearGradient id="cab-body" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2b2452" />
          <stop offset="0.18" stopColor="#1b1636" />
          <stop offset="0.82" stopColor="#151129" />
          <stop offset="1" stopColor="#0b0918" />
        </linearGradient>
        <linearGradient id="cab-marquee" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ff2a6d" />
          <stop offset="0.5" stopColor="#8b3dff" />
          <stop offset="1" stopColor="#00f0ff" />
        </linearGradient>
        <linearGradient id="cab-bezel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0c0a1a" />
          <stop offset="1" stopColor="#1f1a3d" />
        </linearGradient>
        <linearGradient id="cab-panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3170" />
          <stop offset="1" stopColor="#1d1840" />
        </linearGradient>
        <linearGradient id="cab-metal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6b6b82" />
          <stop offset="0.45" stopColor="#2a2a36" />
          <stop offset="1" stopColor="#4a4a5c" />
        </linearGradient>
        <radialGradient id="cab-ball" cx="0.35" cy="0.3" r="0.7">
          <stop offset="0" stopColor="#ff9ab8" />
          <stop offset="0.5" stopColor="#ff2a6d" />
          <stop offset="1" stopColor="#7a0830" />
        </radialGradient>
        <filter id="cab-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="cab-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <clipPath id="cab-lower">
          <rect x="55" y="476" width="290" height="214" />
        </clipPath>
      </defs>

      {/* floor shadow */}
      <ellipse cx="200" cy="712" rx="200" ry="12" fill="#000" opacity="0.7" filter="url(#cab-soft)" />

      {/* body silhouette */}
      <path
        d="M58 104 L342 104 L348 388 L374 396 L374 474 L345 482 L345 692 L55 692 L55 482 L26 474 L26 396 L52 388 Z"
        fill="url(#cab-body)"
      />
      <path
        d="M58 104 L342 104 L348 388 L374 396 L374 474 L345 482 L345 692 L55 692 L55 482 L26 474 L26 396 L52 388 Z"
        fill="none"
        stroke="#00f0ff"
        strokeWidth="2"
        opacity="0.75"
        filter="url(#cab-glow)"
      />

      {/* side art stripes */}
      <g clipPath="url(#cab-lower)" opacity="0.55">
        <path d="M20 700 L140 476 L156 476 L36 700 Z" fill="#ff2a6d" />
        <path d="M48 700 L168 476 L176 476 L56 700 Z" fill="#00f0ff" />
        <path d="M280 700 L380 512 L380 528 L292 700 Z" fill="#ffb800" />
      </g>

      {/* marquee */}
      <g className="cab-marquee">
        <rect x="38" y="10" width="324" height="96" rx="10" fill="#120f26" stroke="#2f2860" strokeWidth="2" />
        <rect x="50" y="22" width="300" height="72" rx="6" fill="url(#cab-marquee)" opacity="0.9" />
        <rect x="50" y="22" width="300" height="72" rx="6" fill="none" stroke="#fff" strokeOpacity="0.35" />
        <text
          x="200"
          y="68"
          textAnchor="middle"
          fontFamily="'Press Start 2P', monospace"
          fontSize="22"
          fill="#fff"
          filter="url(#cab-glow)"
        >
          PROMPTPLAY
        </text>
      </g>

      {/* screen bezel + glass (HTML CRT sits on top of the glass) */}
      <rect x="66" y="118" width="268" height="262" rx="14" fill="url(#cab-bezel)" stroke="#000" strokeOpacity="0.6" />
      <rect x={SCREEN_BOX.x} y={SCREEN_BOX.y} width={SCREEN_BOX.w} height={SCREEN_BOX.h} rx="12" fill="#04030b" />
      <g fill="#05040d">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <rect key={i} x={150 + i * 18} y="332" width="8" height="34" rx="4" />
        ))}
      </g>
      <text x="92" y="358" fontFamily="'Press Start 2P', monospace" fontSize="9" fill="#00f0ff" opacity="0.8">1P</text>
      <text x="290" y="358" fontFamily="'Press Start 2P', monospace" fontSize="9" fill="#ff2a6d" opacity="0.8">2P</text>

      {/* control panel */}
      <path d="M40 392 L360 392 L378 446 L22 446 Z" fill="url(#cab-panel)" />
      <path d="M22 446 L378 446 L374 474 L26 474 Z" fill="#110e24" />
      <path d="M22 446 L378 446" stroke="#ff2a6d" strokeWidth="2" opacity="0.8" filter="url(#cab-glow)" />

      {/* joystick */}
      <ellipse cx="104" cy="424" rx="24" ry="8" fill="#07060f" />
      <rect x="101" y="396" width="6" height="28" rx="2" fill="#2b2b38" />
      <circle cx="104" cy="394" r="13" fill="url(#cab-ball)" />

      {/* action buttons */}
      {[
        { x: 196, y: 426, c: '#00f0ff' },
        { x: 238, y: 416, c: '#ff2a6d' },
        { x: 280, y: 426, c: '#ffb800' },
      ].map((b) => (
        <g key={b.x} className="cab-button">
          <ellipse cx={b.x} cy={b.y + 4} rx="15" ry="8" fill="#07060f" />
          <ellipse cx={b.x} cy={b.y} rx="13" ry="7.5" fill={b.c} filter="url(#cab-glow)" />
          <ellipse cx={b.x - 3} cy={b.y - 2} rx="5" ry="2" fill="#fff" opacity="0.55" />
        </g>
      ))}
      <rect x="318" y="402" width="22" height="10" rx="3" fill="#10b981" opacity="0.9" />
      <rect x="318" y="418" width="22" height="10" rx="3" fill="#10b981" opacity="0.5" />

      {/* coin door */}
      <rect x="148" y="508" width="104" height="146" rx="6" fill="url(#cab-metal)" stroke="#000" strokeOpacity="0.6" />
      <rect x="160" y="520" width="80" height="64" rx="4" fill="#15151d" />
      <rect x="189" y="528" width="22" height="46" rx="5" fill="#0b0b11" stroke="#ffb800" strokeOpacity="0.45" />
      <rect className="cab-slot-glow" x="196" y="534" width="8" height="34" rx="3" fill="#ffb800" filter="url(#cab-glow)" opacity="0" />
      <rect x="198" y="536" width="4" height="30" rx="2" fill="#000" />
      <circle className="cab-credit-led" cx="227" cy="534" r="3.5" fill="#3a1414" />
      <text x="200" y="600" textAnchor="middle" fontFamily="'Press Start 2P', monospace" fontSize="8" fill="#ffb800">
        START
      </text>
      <rect x="180" y="610" width="40" height="26" rx="3" fill="#0b0b11" stroke="#000" />

      {/* kick plate */}
      <rect x="46" y="690" width="308" height="20" rx="3" fill="#0a0816" />
      <path d="M50 690 L350 690" stroke="#ff2a6d" strokeWidth="2" opacity="0.7" filter="url(#cab-glow)" />
    </svg>
  )
}
