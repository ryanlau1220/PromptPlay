import { useState } from 'react'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { isGameId, practiceGames } from './games'
import { ConnectFour, Game2048, LightsOut, MemoryMatch, SlidingPuzzle, TicTacToe } from './BoardGames'
import { Codebreaker, Minesweeper, Sequence, WordGuess } from './PuzzleGames'

const components = { 'tic-tac-toe': TicTacToe, 'connect-four': ConnectFour, memory: MemoryMatch, 'lights-out': LightsOut, minesweeper: Minesweeper, slide: SlidingPuzzle, '2048': Game2048, sequence: Sequence, codebreaker: Codebreaker, 'word-guess': WordGuess }
export function PracticeArcade({ id }: { id: string }) {
  const [round, setRound] = useState(0)
  if (!isGameId(id)) return <div className="practice-page"><a href="#games">← Arcade</a><h1>Game not found</h1></div>
  const game = practiceGames.find(item => item.id === id)!, Game = components[id]
  return <section className="practice-page"><div className="practice-top"><a href="#games" className="back-btn"><ArrowLeft size={15} /> Arcade</a><span className="practice-label">PRACTICE · NO PCC</span></div><div className="practice-title"><div><span className="section-kicker">{game.kind}</span><h1>{game.name}</h1></div><button className="btn-ghost" onClick={() => setRound(n => n + 1)}><RotateCcw size={15} /> Restart</button></div><div className="practice-playfield"><Game key={`${id}-${round}`} /></div></section>
}
