import { useState } from 'react'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { isGameId, practiceGames } from './games'
import type { ComponentType } from 'react'
import { ConnectFour, Game2048, LightsOut, MemoryMatch, SlidingPuzzle, TicTacToe } from './BoardGames'
import { Codebreaker, Minesweeper, NumberRush, Sequence, WordGuess } from './PuzzleGames'

const components = { TicTacToe, ConnectFour, MemoryMatch, LightsOut, Minesweeper, SlidingPuzzle, Game2048, Sequence, Codebreaker, WordGuess, NumberRush } satisfies Record<(typeof practiceGames)[number]['entrypoint'], ComponentType>
export function PracticeArcade({ id }: { id: string }) {
  const [round, setRound] = useState(0)
  if (!isGameId(id)) return <div className="practice-page"><a href="#games">← Arcade</a><h1>Game not found</h1></div>
  const game = practiceGames.find(item => item.id === id)
  if (!game) throw new Error(`Missing game: ${id}`)
  const Game = components[game.entrypoint]
  return <section className="practice-page"><div className="practice-top"><a href="#games" className="back-btn"><ArrowLeft size={15} /> Arcade</a><span className="practice-label">PRACTICE · NO PCC</span></div><div className="practice-title"><div><span className="section-kicker">{game.kind}</span><h1>{game.name}</h1></div><button type="button" className="btn-ghost" onClick={() => setRound(n => n + 1)}><RotateCcw size={15} /> Restart</button></div><a className="btn-ghost" href={`#arcade-duel?game=${id}`}>Open Testnet agreement room</a><p>Practice runs in your browser and awards no PCC. The separate Testnet room stakes real Testnet PCC and settles only when both players report the same result.</p><div className="practice-playfield"><Game key={`${id}-${round}`} /></div></section>
}
