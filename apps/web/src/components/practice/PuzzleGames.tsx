import { useEffect, useState } from 'react'
import { adjacent, codeFeedback, shuffle } from './games'

// These fixed positions identify board cells, rather than reorderable items.
const positionKeys = Array.from({length: 100}, (_, position) => `position-${position}`)
const SIZE = 64, MINES = 10
function makeMines(first: number): Set<number> { const safe = new Set([first, ...adjacent(first, 8, 8, true)]); return new Set(shuffle(Array.from({length:SIZE}, (_, i) => i).filter(i => !safe.has(i))).slice(0, MINES)) }
function uncover(start: number, bombs: Set<number>, opened: Set<number>, flags: Set<number>): Set<number> {
  const next = new Set(opened), queue = [start]
  while (queue.length) { const i = queue.pop(); if (i === undefined) break; if (next.has(i) || bombs.has(i) || flags.has(i)) continue; next.add(i); const around = adjacent(i, 8, 8, true); if (!around.some(n => bombs.has(n))) queue.push(...around.filter(n => !next.has(n))) }
  return next
}
export function Minesweeper() {
  const [bombs, setBombs] = useState<Set<number> | null>(null), [opened, setOpened] = useState(new Set<number>()), [flags, setFlags] = useState(new Set<number>()), [flagMode, setFlagMode] = useState(false), [lost, setLost] = useState(false)
  const win = opened.size === SIZE - MINES
  function select(i: number, flag = flagMode) { if (win || lost || opened.has(i)) return; if (flag) { const next = new Set(flags); if (next.has(i)) next.delete(i); else next.add(i); setFlags(next); return } if (flags.has(i)) return; const field = bombs ?? makeMines(i); if (!bombs) setBombs(field); if (field.has(i)) { setLost(true); return } setOpened(uncover(i, field, opened, flags)) }
  return <><p className="practice-status">{lost ? 'Mine hit' : win ? 'Field cleared!' : `${MINES} mines · ${flags.size} flags`}</p><button type="button" className={`practice-mode ${flagMode ? 'active' : ''}`} onClick={() => setFlagMode(!flagMode)}>⚑ {flagMode ? 'Flag mode on' : 'Flag mode off'}</button><div className="practice-grid mine-grid">{Array.from({length:SIZE}, (_, i) => { const isOpen = opened.has(i), mine = bombs?.has(i), count = bombs ? adjacent(i,8,8,true).filter(n => bombs.has(n)).length : 0; return <button type="button" key={positionKeys[i]} className={`practice-cell mine-cell ${isOpen ? 'revealed' : ''}`} onClick={() => select(i)} onContextMenu={(e) => { e.preventDefault(); select(i, true) }} aria-label={`Cell ${i+1}: ${flags.has(i) ? 'flagged' : isOpen ? `${count} adjacent mines` : 'covered'}`}>{lost && mine ? '✹' : flags.has(i) ? '⚑' : isOpen && count ? count : ''}</button> })}</div></>
}
export function Sequence() {
  const [sequence, setSequence] = useState<number[]>(() => [Math.floor(Math.random()*4)]), [phase, setPhase] = useState<'show'|'input'|'lost'>('show'), [lit, setLit] = useState<number | null>(null), [position, setPosition] = useState(0)
  useEffect(() => { if (phase !== 'show') return; const timers: number[] = []; sequence.forEach((n, i) => { timers.push(window.setTimeout(() => setLit(n), 700 + i * 750)); timers.push(window.setTimeout(() => setLit(null), 1150 + i * 750)) }); timers.push(window.setTimeout(() => { setPosition(0); setPhase('input') }, 700 + sequence.length * 750)); return () => timers.forEach(clearTimeout) }, [phase, sequence])
  function pick(i: number) { if (phase !== 'input') return; if (sequence[position] !== i) { setPhase('lost'); return } if (position + 1 === sequence.length) { setSequence([...sequence, Math.floor(Math.random()*4)]); setPhase('show') } else setPosition(position + 1) }
  return <><p className="practice-status">{phase === 'lost' ? `Game over · ${sequence.length - 1} rounds` : phase === 'show' ? `Round ${sequence.length} · watch` : `Round ${sequence.length} · your turn`}</p><div className="practice-grid sequence-grid">{['cyan','pink','amber','green'].map((color, i) => <button type="button" key={color} className={`sequence-pad ${color} ${lit === i ? 'lit' : ''}`} onClick={() => pick(i)} disabled={phase !== 'input'} aria-label={`Sequence ${color}`} />)}</div></>
}
export function Codebreaker() {
  const [secret] = useState(() => shuffle(['1','2','3','4','5','6']).slice(0,4).join('')), [guess, setGuess] = useState(''), [history, setHistory] = useState<Array<{guess:string;exact:number;misplaced:number}>>([]), [error, setError] = useState('')
  const win = history.some(h => h.exact === 4), lost = history.length >= 10 && !win
  function submit(e: React.FormEvent) { e.preventDefault(); if (win || lost) return; if (!/^[1-6]{4}$/.test(guess) || new Set(guess).size !== 4) { setError('Enter 4 different digits from 1 to 6.'); return } setHistory([{guess, ...codeFeedback(secret,guess)}, ...history]); setGuess(''); setError('') }
  return <><p className="practice-status">{win ? 'Code cracked!' : lost ? `Code was ${secret}` : `Find the 4-digit code · ${10-history.length} tries`}</p><form className="practice-guess" onSubmit={submit}><label><span className="visually-hidden">Four different digits from 1 to 6</span><input className="input-field" value={guess} onChange={e => setGuess(e.target.value.replace(/[^1-6]/g,'').slice(0,4))} inputMode="numeric" placeholder="1 2 3 4" disabled={win || lost} /></label><button type="submit" className="btn-primary" disabled={win || lost}>Guess</button></form>{error && <p role="alert">{error}</p>}<p className="practice-hint">Exact = digit and position · Near = digit only</p><div className="guess-history">{history.map((h, i) => <div key={positionKeys[i]}><strong>{h.guess.split('').join(' ')}</strong><span>{h.exact} exact · {h.misplaced} near</span></div>)}</div></>
}
const words = ['ARCADE','COMPUTE','PIXEL','TERMINAL','WALLET','CODING','PUZZLE','BUTTON','NETWORK','SCREEN','KEYBOARD','FUNCTION']
export function WordGuess() {
  const [word] = useState(() => words[Math.floor(Math.random()*words.length)]), [guesses, setGuesses] = useState<string[]>([])
  const mistakes = guesses.filter(g => !word.includes(g)).length, win = [...word].every(c => guesses.includes(c)), lost = mistakes >= 6
  function pick(c: string) { if (!win && !lost && !guesses.includes(c)) setGuesses([...guesses,c]) }
  return <><p className="practice-status">{win ? 'Word found!' : lost ? `The word was ${word}` : `${6-mistakes} guesses left`}</p><section className="word-display" aria-label={`Word: ${[...word].map(c => guesses.includes(c) || lost ? c : 'blank').join(' ')}`}>{[...word].map((c,i) => <span key={positionKeys[i]}>{guesses.includes(c) || lost ? c : ''}</span>)}</section><div className="letter-grid">{'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => <button type="button" key={c} disabled={guesses.includes(c) || win || lost} className={guesses.includes(c) ? word.includes(c) ? 'correct' : 'wrong' : ''} onClick={() => pick(c)}>{c}</button>)}</div></>
}

export function NumberRush() {
  const [numbers] = useState(() => shuffle(Array.from({ length: 16 }, (_, i) => i + 1)))
  const [next, setNext] = useState(1), [startedAt, setStartedAt] = useState<number | null>(null), [elapsed, setElapsed] = useState<number | null>(null)
  function pick(value: number) {
    if (value !== next || elapsed !== null) return
    const now = Date.now()
    if (startedAt === null) setStartedAt(now)
    if (value === 16) setElapsed(now - (startedAt ?? now))
    setNext(value + 1)
  }
  return <><p className="practice-status">{elapsed !== null ? `Complete · ${(elapsed / 1000).toFixed(1)}s` : `Find ${next} of 16`}</p><div className="practice-grid number-rush-grid">{numbers.map(value => <button type="button" key={value} className={`practice-cell ${value < next ? 'number-found' : ''}`} disabled={value < next || elapsed !== null} onClick={() => pick(value)} aria-label={`Number ${value}`}>{value}</button>)}</div></>
}
