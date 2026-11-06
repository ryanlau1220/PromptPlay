/* ─────────────────────────────────────────────────────────────────────────────
 * COIN INSERT INTRO — first visit only (force with `?intro`)
 *
 * 1. BOOT     stepped loader while the pixel font loads
 * 2. SCENE    synthwave sky, sun and moving floor grid fade up; the cabinet
 *             rises, the marquee flickers on, the CRT powers on. The cabinet
 *             tilts toward the pointer.
 * 3. INSERT   click (or Enter, or wait 4s): a PCC coin flips from the click
 *             point in an arc into the slot → clink, sparks, shake, CREDIT 01
 * 4. DIVE     the camera dives into the CRT until it fills the viewport,
 *             white flash, the lobby is revealed underneath
 *
 * Esc or SKIP jumps straight to the lobby. Reduced motion skips the intro.
 * ───────────────────────────────────────────────────────────────────────────── */

import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { playCoin, playCredit, playWhoosh, unlockAudio } from '../../lib/sfx'
import { ArcadeCabinet, SCREEN_BOX, SLOT_POINT, VIEW } from './ArcadeCabinet'
import { createParticles } from './particles'

const STORAGE_KEY = 'promptplay:intro-seen'
const BOOT_STEPS = ['loading cartridge…', 'syncing near testnet…', 'warming compute…', 'ready']

export function shouldShowIntro(): boolean {
  if (new URLSearchParams(window.location.search).has('intro')) return true
  try {
    return !localStorage.getItem(STORAGE_KEY)
  } catch {
    return false
  }
}

const pct = (value: number, total: number) => `${(value / total) * 100}%`

type Phase = 'boot' | 'ready' | 'inserting' | 'credited' | 'diving' | 'done'

export function CoinInsertIntro({ onEnter, onDone }: { onEnter: () => void; onDone: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const skipRef = useRef<() => void>(() => {})

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* storage unavailable: intro may show again, harmless */
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onEnter()
      onDone()
      return
    }

    const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T
    const cab = $('.intro-cab')
    const screen = $('.intro-crt')
    const slot = $('.intro-slot-anchor')
    const coin = $('.intro-coin')
    const fill = $('.boot-fill')
    const log = $('.boot-log')
    const particles = createParticles($<HTMLCanvasElement>('.intro-particles'))

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    let phase: Phase = 'boot'
    let entered = false
    let pending: gsap.core.Tween | null = null
    let slotPulse: gsap.core.Tween | null = null
    const enter = () => {
      if (entered) return
      entered = true
      onEnter()
    }
    const finish = () => {
      phase = 'done'
      document.body.style.overflow = previousOverflow
      onDone()
    }

    const ctx = gsap.context(() => {}, root)
    const tiltX = gsap.quickTo(cab, 'rotationX', { duration: 0.6, ease: 'power3.out' })
    const tiltY = gsap.quickTo(cab, 'rotationY', { duration: 0.6, ease: 'power3.out' })

    // ── 1–2. Boot, then reveal the scene ──────────────────────────────────
    const fontReady = Promise.race([
      document.fonts.load('22px "Press Start 2P"'),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ])
    const progress = { v: 0 }
    let boot: gsap.core.Timeline
    ctx.add(() => {
      boot = gsap.timeline()
      boot
        .to(progress, {
          v: 100,
          duration: 1.4,
          ease: 'steps(24)',
          onUpdate() {
            fill.style.transform = `scaleX(${progress.v / 100})`
            log.textContent = BOOT_STEPS[Math.min(3, Math.floor(progress.v / 25))]
          },
        })
        .addPause('+=0.15', () => {
          void fontReady.then(() => {
            if (phase === 'boot') boot.resume()
          })
        })
        .to('.intro-boot', { autoAlpha: 0, duration: 0.45 })
        .from('.intro-sky', { autoAlpha: 0, duration: 1.2 }, '<')
        .from('.intro-sun', { yPercent: 35, autoAlpha: 0, duration: 1.6, ease: 'power3.out' }, '<')
        .from('.intro-floor', { autoAlpha: 0, duration: 1.2 }, '<0.2')
        .from(cab, { y: 160, scale: 0.84, autoAlpha: 0, duration: 1.3, ease: 'power4.out' }, '<')
        .fromTo('.cab-marquee', { opacity: 0 }, { keyframes: { opacity: [0, 1, 0.15, 1, 0.4, 1] }, duration: 0.7, ease: 'none' }, '-=0.6')
        .fromTo('.crt-power', { scaleX: 0, scaleY: 0.012, autoAlpha: 1 }, { scaleX: 1, duration: 0.16, ease: 'power2.out' }, '-=0.25')
        .to('.crt-power', { scaleY: 1, duration: 0.14, ease: 'power2.in' })
        .to('.crt-power', { autoAlpha: 0, duration: 0.3 })
        .from('.crt-title, .crt-hands, .crt-insert', { autoAlpha: 0, y: 8, stagger: 0.09, duration: 0.3 }, '<')
        .from('.cab-button', { opacity: 0.15, stagger: 0.1, duration: 0.15 }, '<')
        .to('.intro-cta', { autoAlpha: 1, duration: 0.4 })
        .add(() => {
          phase = 'ready'
          slotPulse = gsap.to('.cab-slot-glow', { opacity: 0.9, duration: 0.6, repeat: -1, yoyo: true, ease: 'sine.inOut' })
          pending = gsap.delayedCall(4, () => insert(null))
        })
    })

    // ── 3. Coin flight ────────────────────────────────────────────────────
    function insert(from: { x: number; y: number } | null) {
      if (phase !== 'ready') return
      phase = 'inserting'
      pending?.kill()
      slotPulse?.kill()
      const r = slot.getBoundingClientRect()
      const sx = r.left + r.width / 2
      const sy = r.top + r.height / 2
      const start = from ?? { x: window.innerWidth * 0.82, y: window.innerHeight + 40 }
      const apex = Math.min(start.y, sy) - Math.max(110, window.innerHeight * 0.16)

      ctx.add(() => {
        gsap.set(coin, { x: start.x, y: start.y, xPercent: -50, yPercent: -50, scale: 0.4, rotationY: 0, transformPerspective: 500, autoAlpha: 1 })
        gsap
          .timeline()
          .to('.intro-cta', { autoAlpha: 0, duration: 0.2 }, 0)
          .to(coin, { scale: 1.15, duration: 0.35, ease: 'power2.out' }, 0)
          .to(coin, { x: sx, duration: 0.85, ease: 'power1.inOut' }, 0)
          .to(coin, { y: apex, duration: 0.42, ease: 'power2.out' }, 0)
          .to(coin, { y: sy - 4, duration: 0.43, ease: 'power2.in' }, 0.42)
          .to(coin, { rotationY: 1440 + 90, duration: 0.85, ease: 'power1.out' }, 0)
          .to(coin, { scale: 0.75, duration: 0.3 }, 0.55)
          .to(coin, { y: sy + 16, autoAlpha: 0, duration: 0.12, ease: 'power2.in' }, 0.85)
          .add(() => impact(sx, sy), 0.86)
      })
    }

    function impact(sx: number, sy: number) {
      playCoin()
      particles.burst(sx, sy)
      ctx.add(() => {
        gsap.fromTo(cab, { x: 0 }, { keyframes: { x: [-7, 6, -4, 3, -1, 0] }, duration: 0.32, ease: 'none' })
        gsap.fromTo('.cab-slot-glow', { opacity: 1 }, { opacity: 0.4, duration: 0.7 })
        gsap.to('.cab-credit-led', { attr: { fill: '#10b981' }, duration: 0.1 })
        gsap.fromTo('.intro-flash', { opacity: 0.3 }, { opacity: 0, duration: 0.35 })
        gsap.to('.crt-insert', { autoAlpha: 0, duration: 0.05 })
        gsap.fromTo('.crt-credit', { autoAlpha: 0, scale: 2.2 }, { autoAlpha: 1, scale: 1, duration: 0.45, ease: 'back.out(3)', delay: 0.08 })
        gsap.fromTo('.crt-hands img', { y: 0 }, { keyframes: { y: [0, -10, 0, -4, 0] }, duration: 0.7, stagger: 0.09, ease: 'power1.inOut', delay: 0.15 })
        gsap.delayedCall(0.15, playCredit)
        gsap.delayedCall(0.75, () => {
          $('.crt-press').classList.add('is-on')
          phase = 'credited'
          pending = gsap.delayedCall(1.5, dive)
        })
      })
    }

    // ── 4. Dive into the screen ───────────────────────────────────────────
    function dive() {
      if (phase !== 'credited') return
      phase = 'diving'
      pending?.kill()
      const s = screen.getBoundingClientRect()
      const dx = window.innerWidth / 2 - (s.left + s.width / 2)
      const dy = window.innerHeight / 2 - (s.top + s.height / 2)
      const scale = Math.max(window.innerWidth / s.width, window.innerHeight / s.height) * 1.12
      const speed = { v: 1 }
      playWhoosh()

      ctx.add(() => {
        gsap
          .timeline({ onComplete: finish })
          .to(cab, { x: dx, y: dy, scale, rotationX: 0, rotationY: 0, duration: 1.15, ease: 'power3.in', overwrite: 'auto' }, 0)
          .to('.intro-sky, .intro-sun', { scale: 1.45, duration: 1.15, ease: 'power2.in' }, 0)
          .to('.intro-floor', { yPercent: 25, autoAlpha: 0, duration: 1, ease: 'power2.in' }, 0)
          .to(speed, { v: 14, duration: 1.1, ease: 'power2.in', onUpdate: () => particles.setSpeed(speed.v) }, 0)
          .to('.crt-content', { autoAlpha: 0, duration: 0.25 }, 0.72)
          .to('.intro-flash', { opacity: 1, duration: 0.18, ease: 'power2.in' }, 0.94)
          .add(enter, 1.12)
          .to(root, { autoAlpha: 0, duration: 0.55, ease: 'power2.out' }, 1.15)
      })
    }

    function skip() {
      if (phase === 'done' || phase === 'diving') return
      phase = 'diving'
      ctx.getTweens().forEach((t: gsap.core.Animation) => t.kill())
      pending?.kill()
      enter()
      gsap.to(root, { autoAlpha: 0, duration: 0.35, onComplete: finish })
    }
    skipRef.current = skip

    // ── Input ─────────────────────────────────────────────────────────────
    function advance(from: { x: number; y: number } | null) {
      unlockAudio()
      if (phase === 'boot') boot.timeScale(5)
      else if (phase === 'ready') insert(from)
      else if (phase === 'credited') dive()
    }
    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.intro-skip')) return
      advance({ x: e.clientX, y: e.clientY })
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skip()
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        advance(null)
      }
    }
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY > 0) advance(null)
    }
    const onMove = (e: PointerEvent) => {
      if (phase === 'diving' || phase === 'done') return
      tiltY((e.clientX / window.innerWidth - 0.5) * 14)
      tiltX(-(e.clientY / window.innerHeight - 0.5) * 10)
    }
    root.addEventListener('click', onClick)
    root.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointermove', onMove)

    return () => {
      root.removeEventListener('click', onClick)
      root.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointermove', onMove)
      pending?.kill()
      slotPulse?.kill()
      tiltX.tween.kill()
      tiltY.tween.kill()
      ctx.revert()
      particles.destroy()
      document.body.style.overflow = previousOverflow
    }
    // Runs once per mount; the callbacks are stable state setters in the parent.
  }, [])

  return (
    <div ref={rootRef} className="intro-root" role="dialog" aria-modal="true" aria-label="PromptPlay arcade">
      <div className="intro-sky" />
      <div className="intro-sun" />
      <div className="intro-floor">
        <div className="intro-floor-grid" />
      </div>
      <canvas className="intro-particles" />

      <div className="intro-stage">
        <div className="intro-cab">
          <ArcadeCabinet />
          <div
            className="intro-crt"
            style={{
              left: pct(SCREEN_BOX.x, VIEW.w),
              top: pct(SCREEN_BOX.y, VIEW.h),
              width: pct(SCREEN_BOX.w, VIEW.w),
              height: pct(SCREEN_BOX.h, VIEW.h),
            }}
          >
            <div className="crt-content">
              <div className="crt-title">RPS BLITZ</div>
              <div className="crt-hands">
                <img src="/hands/rock.svg" alt="" />
                <img src="/hands/paper.svg" alt="" />
                <img src="/hands/scissors.svg" alt="" />
              </div>
              <div className="crt-status">
                <span className="crt-insert">INSERT COIN</span>
                <span className="crt-credit">CREDIT 01</span>
              </div>
              <div className="crt-press">PRESS START</div>
            </div>
            <div className="crt-power" />
            <div className="crt-glass" />
          </div>
          <div
            className="intro-slot-anchor"
            style={{ left: pct(SLOT_POINT.x, VIEW.w), top: pct(SLOT_POINT.y, VIEW.h) }}
          />
        </div>
      </div>

      <p className="intro-cta">CLICK TO INSERT COIN</p>

      <div className="intro-coin">
        <span className="coin-face">PCC</span>
        <span className="coin-face coin-back">PCC</span>
      </div>

      <button
        type="button"
        className="intro-skip"
        onClick={() => skipRef.current()}
      >
        SKIP &gt;&gt;
      </button>

      <div className="intro-boot">
        <p className="boot-brand">PROMPTPLAY</p>
        <p className="boot-log">booting…</p>
        <div className="boot-bar">
          <span className="boot-fill" />
        </div>
      </div>

      <div className="intro-flash" />
      <div className="intro-scanlines" />
    </div>
  )
}
