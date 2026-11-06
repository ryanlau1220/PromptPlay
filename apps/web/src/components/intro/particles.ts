/** Canvas layer for the intro: twinkling stars, rising motes and spark bursts. */

type Star = { x: number; y: number; size: number; phase: number; color: string }
type Mote = { x: number; y: number; vy: number; drift: number; life: number }
type Spark = { x: number; y: number; vx: number; vy: number; life: number; color: string }

const STAR_COLORS = ['#c9ccf5', '#00f0ff', '#ff2a6d', '#ffb800', '#9b7bff']
const SPARK_COLORS = ['#fff2b0', '#ffb800', '#ffd54a', '#ffffff']

export function createParticles(canvas: HTMLCanvasElement) {
  const g = canvas.getContext('2d')
  if (!g) return { burst: () => {}, setSpeed: () => {}, destroy: () => {} }
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  let w = 0
  let h = 0
  let stars: Star[] = []
  let motes: Mote[] = []
  let sparks: Spark[] = []
  let speed = 1
  let raf = 0

  function resize() {
    w = canvas.width = window.innerWidth * dpr
    h = canvas.height = window.innerHeight * dpr
    const count = Math.min(160, Math.floor(window.innerWidth / 9))
    stars = Array.from({ length: count }, (_, i) => ({
      x: Math.random() * w,
      y: Math.random() * h * 0.62,
      size: (Math.random() * 1.6 + 0.6) * dpr,
      phase: Math.random() * Math.PI * 2,
      color: STAR_COLORS[i % STAR_COLORS.length],
    }))
    motes = Array.from({ length: 18 }, () => newMote(true))
  }

  function newMote(anywhere: boolean): Mote {
    return {
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : h + 10,
      vy: (0.25 + Math.random() * 0.5) * dpr,
      drift: (Math.random() - 0.5) * 0.3 * dpr,
      life: Math.random() * Math.PI * 2,
    }
  }

  function frame() {
    g!.clearRect(0, 0, w, h)

    for (const s of stars) {
      s.phase += 0.03
      g!.globalAlpha = Math.max(0.1, 0.45 + Math.sin(s.phase) * 0.35)
      g!.fillStyle = s.color
      g!.fillRect(s.x, s.y, s.size, s.size)
    }

    g!.fillStyle = '#00f0ff'
    g!.shadowColor = '#00f0ff'
    g!.shadowBlur = 8 * dpr
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i]
      m.y -= m.vy * speed
      m.x += m.drift * speed
      m.life += 0.02
      if (m.y < -10) motes[i] = newMote(false)
      g!.globalAlpha = 0.35 + Math.sin(m.life) * 0.25
      g!.fillRect(m.x, m.y, 2.5 * dpr, 2.5 * dpr * speed)
    }

    g!.shadowColor = '#ffb800'
    for (const p of sparks) {
      p.vy += 0.22 * dpr
      p.vx *= 0.98
      p.x += p.vx
      p.y += p.vy
      p.life -= 0.022
      g!.globalAlpha = Math.max(0, p.life)
      g!.fillStyle = p.color
      g!.fillRect(p.x, p.y, 3 * dpr, 3 * dpr)
    }
    sparks = sparks.filter((p) => p.life > 0)

    g!.shadowBlur = 0
    g!.globalAlpha = 1
    raf = requestAnimationFrame(frame)
  }

  resize()
  window.addEventListener('resize', resize)
  raf = requestAnimationFrame(frame)

  return {
    /** Spray sparks from a viewport point (CSS px). */
    burst(x: number, y: number, count = 34) {
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3
        const v = (2 + Math.random() * 5) * dpr
        sparks.push({
          x: x * dpr,
          y: y * dpr,
          vx: Math.cos(angle) * v,
          vy: Math.sin(angle) * v,
          life: 0.7 + Math.random() * 0.5,
          color: SPARK_COLORS[i % SPARK_COLORS.length],
        })
      }
    },
    /** Motes stream faster during the camera dive. */
    setSpeed(value: number) {
      speed = value
    },
    destroy() {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    },
  }
}
