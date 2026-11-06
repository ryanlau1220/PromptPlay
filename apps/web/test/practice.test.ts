import { describe, expect, test } from 'bun:test'
import { adjacent, codeFeedback, drop, move2048, practiceGames, slide, winner } from '../src/components/practice/games'

describe('practice game rules', () => {
  test('catalog has eleven distinct playable identifiers', () => {
    expect(practiceGames).toHaveLength(11)
    expect(new Set(practiceGames.map(game => game.id)).size).toBe(11)
  })
  test('detects lines and diagonals without wrapping across rows', () => {
    expect(winner(['X',null,'O',null,'X','O',null,null,'X'],3,3,3)).toBe('X')
    expect(winner([null,'X','X','X',null,null,null,null,null],3,3,3)).toBeNull()
    expect(winner(Array(42).fill(null).map((_,i) => [3,9,15,21].includes(i) ? 'O' : null),7,6,4)).toBe('O')
  })
  test('drops to the bottom and rejects a full column', () => {
    let board: (string|null)[] = Array(42).fill(null)
    for (let i = 0; i < 6; i++) board = drop(board, 0, 'X')!
    expect(drop(board, 0, 'O')).toBeNull()
    expect(board[35]).toBe('X')
  })
  test('slides only adjacent tiles and counts grid neighbors correctly', () => {
    const board = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,0]
    expect(slide(board, 0)).toBeNull()
    expect(slide(board, 14)?.slice(12)).toEqual([13,14,0,15])
    expect(adjacent(0,8,8,true)).toEqual([1,8,9])
  })
  test('2048 merges each tile once and handles all directions', () => {
    const board = [2,2,2,2,0,0,0,0,0,0,0,0,0,0,0,0]
    expect(move2048(board,'left').slice(0,4)).toEqual([4,4,0,0])
    expect(move2048(board,'right').slice(0,4)).toEqual([0,0,4,4])
    expect(move2048([2,0,0,0,2,0,0,0,4,0,0,0,0,0,0,0],'up').filter(Boolean)).toEqual([4,4])
  })
  test('code feedback counts exact and misplaced digits once', () => {
    expect(codeFeedback('1234','1325')).toEqual({exact:1,misplaced:2})
    expect(codeFeedback('1123','2111')).toEqual({exact:1,misplaced:2})
  })
})
