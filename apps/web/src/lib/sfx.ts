/**
 * Synthesized arcade sound effects (Web Audio, no asset files).
 * Browsers only allow audio after a user gesture, so call `unlockAudio()`
 * from a click/key handler first; until then every effect is a no-op.
 */

let ctx: AudioContext | null = null

export function unlockAudio() {
  if (ctx) return
  try {
    ctx = new AudioContext()
    void ctx.resume()
  } catch {
    ctx = null
  }
}

function tone(type: OscillatorType, freq: number, start: number, length: number, gain: number) {
  if (!ctx) return
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  amp.gain.setValueAtTime(gain, start)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + length)
  osc.connect(amp).connect(ctx.destination)
  osc.start(start)
  osc.stop(start + length)
}

function noise(start: number, length: number, gain: number, from: number, to: number) {
  if (!ctx) return
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  const filter = ctx.createBiquadFilter()
  const amp = ctx.createGain()
  src.buffer = buffer
  filter.type = 'bandpass'
  filter.Q.value = 1.2
  filter.frequency.setValueAtTime(from, start)
  filter.frequency.exponentialRampToValueAtTime(to, start + length)
  amp.gain.setValueAtTime(0.0001, start)
  amp.gain.exponentialRampToValueAtTime(gain, start + length * 0.6)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + length)
  src.connect(filter).connect(amp).connect(ctx.destination)
  src.start(start)
}

/** Metallic coin hitting the slot. */
export function playCoin() {
  if (!ctx) return
  const t = ctx.currentTime
  tone('triangle', 2637, t, 0.35, 0.18)
  tone('sine', 3951, t + 0.005, 0.5, 0.08)
  tone('square', 180, t, 0.05, 0.05)
  tone('triangle', 2093, t + 0.09, 0.25, 0.1)
}

/** Rising 8-bit credit jingle. */
export function playCredit() {
  if (!ctx) return
  const t = ctx.currentTime
  ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone('square', f, t + i * 0.07, 0.12, 0.06))
}

/** Whoosh while the camera dives into the screen. */
export function playWhoosh() {
  if (!ctx) return
  noise(ctx.currentTime, 0.9, 0.25, 300, 4000)
}
