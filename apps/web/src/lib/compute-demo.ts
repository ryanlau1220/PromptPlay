export const demoMoves = ['Rock', 'Paper', 'Scissors'] as const
type Duel = { wins: number; losses: number; previous: number | null; result: string }
export const initialDemoDuel: Duel = { wins: 0, losses: 0, previous: null, result: '' }

export function playDemoRound(current: Duel, choice: number): Duel {
  if (current.wins === 2 || current.losses === 2) return current
  const opponent = current.previous === null ? 0 : (current.previous + 1) % demoMoves.length
  const outcome = (choice + demoMoves.length - opponent) % demoMoves.length
  const strategy = current.previous === null ? 'The computer opens with Rock.' : `The computer counters your previous ${demoMoves[current.previous]}.`
  const result = outcome === 0 ? 'Tied round' : outcome === 1 ? 'You win the round' : 'Computer wins the round'
  return {
    wins: current.wins + Number(outcome === 1),
    losses: current.losses + Number(outcome === 2),
    previous: choice,
    result: `${demoMoves[choice]} versus ${demoMoves[opponent]}. ${result}. ${strategy}`
  }
}
