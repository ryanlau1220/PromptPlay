import { useCallback, useEffect, useState } from 'react'
import { adjacent, drop, move2048, shuffle, slide, ticTacToeReply, winner } from './games'

// These fixed positions identify board cells, rather than reorderable items.
const positionKeys = Array.from({length: 100}, (_, position) => `position-${position}`)
type Cell = string | null
function connectFourReply(board: Cell[]): Cell[] {
  const choices = Array.from({ length: 7 }, (_, col) => drop(board, col, 'O')).filter((value): value is Cell[] => value !== null)
  const winning = choices.find(next => winner(next, 7, 6, 4) === 'O')
  if (winning) return winning
  const safeChoices = choices.filter(next =>
    !Array.from({ length: 7 }, (_, col) => drop(next, col, 'X')).some(reply => reply && winner(reply, 7, 6, 4) === 'X'),
  )
  return shuffle(safeChoices.length ? safeChoices : choices)[0] ?? board
}
export function TicTacToe() {
  const [{ board, reason }, setPosition] = useState<{ board: Cell[]; reason: string }>({ board: Array(9).fill(null), reason: '' })
  const result = winner(board, 3, 3, 3), over = !!result || board.every(Boolean)
  function play(i: number) {
    if (over || board[i]) return
    const next = board.map((cell, index) => index === i ? 'X' : cell)
    setPosition(ticTacToeReply(next))
  }
  return <><p className="practice-status">{result ? result === 'X' ? 'You win!' : 'Computer wins' : over ? 'Draw' : 'Your turn · X'}</p>{reason && <output>{reason}</output>}<div className="practice-grid tictactoe">{board.map((cell, i) => <button type="button" key={positionKeys[i]} className={`practice-cell mark-${cell ?? 'empty'}`} aria-label={`Row ${Math.floor(i / 3) + 1}, column ${i % 3 + 1}: ${cell ?? 'empty'}`} disabled={over || !!cell} onClick={() => play(i)}>{cell}</button>)}</div></>
}
export function ConnectFour() {
  const [board, setBoard] = useState<Cell[]>(Array(42).fill(null))
  const result = winner(board, 7, 6, 4), over = !!result || board.every(Boolean)
  function play(col: number) { if (over) return; const next = drop(board, col, 'X'); if (!next) return; setBoard(winner(next, 7, 6, 4) || next.every(Boolean) ? next : connectFourReply(next)) }
  return <><p className="practice-status">{result ? result === 'X' ? 'You win!' : 'Computer wins' : over ? 'Draw' : 'Drop four in a row'}</p><div className="connect-board"><div className="connect-actions">{Array.from({length:7}, (_, i) => <button type="button" key={positionKeys[i]} onClick={() => play(i)} disabled={over || !!board[i]} aria-label={`Drop in column ${i + 1}`}>↓</button>)}</div><div className="practice-grid connect-grid">{board.map((cell, i) => <span key={positionKeys[i]} className={`connect-slot mark-${cell ?? 'empty'}`} />)}</div></div></>
}
const icons = ['◆','●','▲','★','☀','✿','♥','☂']
export function MemoryMatch() {
  const [cards] = useState(() => shuffle([...icons, ...icons]))
  const [open, setOpen] = useState<number[]>([]), [matched, setMatched] = useState<number[]>([]), [moves, setMoves] = useState(0)
  useEffect(() => { if (open.length !== 2) return; const timer = window.setTimeout(() => { if (cards[open[0]] === cards[open[1]]) setMatched(old => [...old, ...open]); setOpen([]) }, 650); return () => clearTimeout(timer) }, [open, cards])
  function flip(i: number) { if (open.length === 2 || open.includes(i) || matched.includes(i)) return; setOpen([...open, i]); if (open.length === 1) setMoves(moves + 1) }
  return <><p className="practice-status">{matched.length === 16 ? `All pairs found · ${moves} moves` : `${matched.length / 2} / 8 pairs · ${moves} moves`}</p><div className="practice-grid memory-grid">{cards.map((card, i) => <button type="button" key={positionKeys[i]} className={`practice-cell ${open.includes(i) || matched.includes(i) ? 'revealed' : ''}`} onClick={() => flip(i)} disabled={matched.includes(i)} aria-label={`Card ${i + 1}: ${open.includes(i) || matched.includes(i) ? card : 'hidden'}`}>{open.includes(i) || matched.includes(i) ? card : '?'}</button>)}</div></>
}
function toggleLights(board: boolean[], i: number) { const next = [...board]; for (const n of [i, ...adjacent(i, 5, 5)]) next[n] = !next[n]; return next }
function newLights() { let b = Array<boolean>(25).fill(false); for (const i of shuffle(Array.from({length:25}, (_, n) => n)).slice(0, 11)) b = toggleLights(b, i); return b.some(Boolean) ? b : toggleLights(b, 12) }
export function LightsOut() {
  const [board, setBoard] = useState(newLights), [moves, setMoves] = useState(0); const win = board.every(v => !v)
  return <><p className="practice-status">{win ? `All lights out · ${moves} moves` : 'Turn off every light'}</p><div className="practice-grid lights-grid">{board.map((lit, i) => <button type="button" key={positionKeys[i]} className={`practice-cell light ${lit ? 'lit' : ''}`} disabled={win} onClick={() => { setBoard(toggleLights(board, i)); setMoves(moves + 1) }} aria-label={`Light ${i + 1}: ${lit ? 'on' : 'off'}`} />)}</div></>
}
export function SlidingPuzzle() {
  const [board, setBoard] = useState(() => { let b = [...Array.from({length:15}, (_, i) => i + 1), 0]; let last = -1; for (let n = 0; n < 140; n++) { const z = b.indexOf(0), choices = adjacent(z,4,4).filter(i => i !== last); const chosen = choices[Math.floor(Math.random() * choices.length)]; b = slide(b, chosen) ?? b; last = z } return b.every((v, i) => v === (i + 1) % 16) ? (slide(b, 14) ?? b) : b })
  const [moves, setMoves] = useState(0), win = board.every((n, i) => n === (i + 1) % 16)
  return <><p className="practice-status">{win ? `Solved in ${moves} moves` : 'Arrange the tiles in order'}</p><div className="practice-grid slide-grid">{board.map((n, i) => <button type="button" key={positionKeys[i]} className={`practice-cell ${n ? '' : 'empty'}`} disabled={!n || win || !slide(board, i)} onClick={() => { const next = slide(board, i); if (next) { setBoard(next); setMoves(moves + 1) } }} aria-label={n ? `Move tile ${n}` : 'Empty space'}>{n || ''}</button>)}</div></>
}
function addTile(board: number[]) { const empty = board.flatMap((v, i) => v ? [] : [i]); if (!empty.length) return board; const next = [...board]; next[empty[Math.floor(Math.random() * empty.length)]] = Math.random() < .9 ? 2 : 4; return next }
export function Game2048() {
  const [board, setBoard] = useState(() => addTile(addTile(Array<number>(16).fill(0))))
  const win = board.some(v => v >= 2048), lost = !['left','right','up','down'].some(dir => move2048(board, dir as 'left'|'right'|'up'|'down').some((v, i) => v !== board[i]))
  const move = useCallback((direction: 'left'|'right'|'up'|'down') => { if (lost) return; setBoard(old => { const next = move2048(old, direction); return next.some((v, i) => v !== old[i]) ? addTile(next) : old }) }, [lost])

  return (
    <>
      <p className="practice-status">{lost ? 'No moves left' : win ? '2048 reached!' : 'Combine matching tiles'}</p>
      <p>Use the move buttons, or focus one and press an arrow key.</p>
      <div className="practice-grid slide-grid tiles-2048">
        {board.map((number, index) => <div key={positionKeys[index]} className={`practice-cell tile-${number || 'empty'}`}>{number || ''}</div>)}
      </div>
      <section className="practice-directions" aria-label="Move tiles" onKeyDown={event => {
        const directions = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' } as const
        const direction = directions[event.key as keyof typeof directions]
        if (direction) {
          event.preventDefault()
          move(direction)
        }
      }}>
        {(['left', 'up', 'down', 'right'] as const).map((direction, index) => (
          <button type="button" key={direction} onClick={() => move(direction)} aria-label={`Move ${direction}`}>{['←', '↑', '↓', '→'][index]}</button>
        ))}
      </section>
    </>
  )
}
