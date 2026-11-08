import { Brain, Bomb, Code, Lightbulb, Search, Sparkles, Zap } from 'lucide-react'
import type { GameId } from './games'

// These fixed positions identify board cells, rather than reorderable items.
const positionKeys = Array.from({length: 100}, (_, position) => `position-${position}`)
type ArtworkId = GameId | 'rps'
export function GameArtwork({ id }: { id: ArtworkId }) {
  return <div className={`game-artwork art-${id}`} aria-hidden="true">
    <div className="game-art-glow" />
    {id === 'rps' && <div className="art-rps">{['rock','paper','scissors'].map(hand => <img src={`/hands/${hand}.svg`} alt="" key={hand} />)}</div>}
    {id === 'tic-tac-toe' && <div className="art-tic">{['X','','O','','X','','O','','X'].map((mark,i) => <span key={positionKeys[i]} className={mark === 'O' ? 'art-pink' : ''}>{mark}</span>)}</div>}
    {id === 'connect-four' && <div className="art-connect">{Array.from({length:16},(_,i) => <i key={positionKeys[i]} className={[0,5,10,15].includes(i) ? 'cyan' : [4,9,14].includes(i) ? 'pink' : ''} />)}</div>}
    {id === 'memory' && <div className="art-memory"><span><Brain size={32}/></span><span><Sparkles size={27}/></span><span><Brain size={32}/></span></div>}
    {id === 'lights-out' && <div className="art-light"><div className="art-light-rays" /><Lightbulb size={56} strokeWidth={1.7} /></div>}
    {id === 'minesweeper' && <div className="art-mines"><div><i /><i /><i /><i /></div><Bomb size={55} strokeWidth={1.7} /></div>}
    {id === 'slide' && <div className="art-slide">{[1,2,3,4,5,6,7,8].map((n) => <span key={n}>{n}</span>)}</div>}
    {id === '2048' && <div className="art-2048"><span>2</span><span>4</span><span>8</span><strong>16</strong></div>}
    {id === 'sequence' && <div className="art-sequence">{[0,1,2,3].map(n => <span key={n} />)}</div>}
    {id === 'codebreaker' && <div className="art-code"><Code size={48} strokeWidth={1.7}/><div><i/><i/><i/><i/></div></div>}
    {id === 'number-rush' && <div className="art-rush"><div><span>1</span><span>3</span><span>4</span><span>2</span></div><Zap size={39} fill="currentColor" /></div>}
    {id === 'word-guess' && <div className="art-word"><div><span>A</span><span>?</span><span>Z</span></div><Search size={41} strokeWidth={2} /></div>}
  </div>
}
