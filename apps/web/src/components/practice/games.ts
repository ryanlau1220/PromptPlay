export const practiceGames = [
  { id: 'tic-tac-toe', name: 'Tic-Tac-Toe', kind: 'Strategy' },
  { id: 'connect-four', name: 'Connect Four', kind: 'Strategy' },
  { id: 'memory', name: 'Memory Match', kind: 'Memory' },
  { id: 'lights-out', name: 'Lights Out', kind: 'Puzzle' },
  { id: 'minesweeper', name: 'Minesweeper', kind: 'Puzzle' },
  { id: 'slide', name: 'Sliding Puzzle', kind: 'Puzzle' },
  { id: '2048', name: '2048', kind: 'Puzzle' },
  { id: 'sequence', name: 'Sequence', kind: 'Memory' },
  { id: 'codebreaker', name: 'Codebreaker', kind: 'Logic' },
  { id: 'word-guess', name: 'Word Guess', kind: 'Word' },
  { id: 'number-rush', name: 'Number Rush', kind: 'Speed' },
] as const
export type GameId = typeof practiceGames[number]['id']
export const isGameId = (value: string): value is GameId => practiceGames.some(game => game.id === value)
export function shuffle<T>(items: T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]] }
  return result
}
export function winner(board: (string | null)[], width: number, height: number, run: number): string | null {
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const player = board[y * width + x]; if (!player) continue
    for (const [dx, dy] of [[1,0],[0,1],[1,1],[1,-1]] as const) {
      const endX = x + dx * (run - 1), endY = y + dy * (run - 1)
      if (endX >= 0 && endX < width && endY >= 0 && endY < height && Array.from({ length: run }, (_, n) => board[(y + dy * n) * width + x + dx * n]).every(cell => cell === player)) return player
    }
  }
  return null
}
export function drop(board: (string | null)[], col: number, player: string): (string | null)[] | null {
  if (col < 0 || col > 6) return null
  for (let row = 5; row >= 0; row--) if (!board[row * 7 + col]) { const next = [...board]; next[row * 7 + col] = player; return next }
  return null
}
export function adjacent(index: number, width: number, height: number, diagonals = false): number[] {
  const x = index % width, y = Math.floor(index / width), result: number[] = []
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((!dx && !dy) || (!diagonals && dx && dy)) continue
    const nx = x + dx, ny = y + dy
    if (nx >= 0 && nx < width && ny >= 0 && ny < height) result.push(ny * width + nx)
  }
  return result
}
export function slide(board: number[], index: number): number[] | null {
  const empty = board.indexOf(0)
  if (!adjacent(empty, 4, 4).includes(index)) return null
  const next = [...board]; [next[empty], next[index]] = [next[index], next[empty]]; return next
}
export function move2048(board: number[], direction: 'left' | 'right' | 'up' | 'down'): number[] {
  const next = [...board]
  for (let line = 0; line < 4; line++) {
    const indices = Array.from({ length: 4 }, (_, n) => direction === 'left' ? line * 4 + n : direction === 'right' ? line * 4 + 3 - n : direction === 'up' ? n * 4 + line : (3 - n) * 4 + line)
    const vals = indices.map(i => board[i]).filter(Boolean), merged: number[] = []
    for (let i = 0; i < vals.length; i++) { if (vals[i] === vals[i + 1]) { merged.push(vals[i] * 2); i++ } else merged.push(vals[i]) }
    indices.forEach((index, i) => { next[index] = merged[i] ?? 0 })
  }
  return next
}
export function codeFeedback(secret: string, guess: string) {
  let exact = 0, misplaced = 0
  const remainingSecret: string[] = [], remainingGuess: string[] = []
  for (let i = 0; i < secret.length; i++) { if (secret[i] === guess[i]) exact++; else { remainingSecret.push(secret[i]); remainingGuess.push(guess[i]) } }
  for (const digit of remainingGuess) { const i = remainingSecret.indexOf(digit); if (i !== -1) { misplaced++; remainingSecret.splice(i, 1) } }
  return { exact, misplaced }
}
