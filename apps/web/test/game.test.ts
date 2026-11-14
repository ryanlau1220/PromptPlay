import { describe, expect, test } from 'bun:test'
import { amount, commitment, confirmStakeTransfer, matchEconomy, pcc, type Match } from '../src/lib/game'
describe('game client encoding', () => {
  test('matches the Rust commitment byte encoding', async () => {
    expect(await commitment('player.testnet','42',1,2, Uint8Array.from({length:32},(_,i)=>i))).toBe('KT9oaOWHW2YbpYYnLgD7G7amYDR6eLcY22iLJumReJk=')
    expect(await commitment('player.testnet','42',2,2, Uint8Array.from({length:32},(_,i)=>i))).not.toBe('KT9oaOWHW2YbpYYnLgD7G7amYDR6eLcY22iLJumReJk=')
  })
  test('conserves both stakes through the claim and transfer states', () => {
    const match: Match = {
      id: '1', stake: '5000000', phase: 'Completed', deadline: '0', winner: 'a.testnet',
      round: 2, wins: [2, 0],
      players: [
        { account: 'a.testnet', funded: true, commitment: null, revealed: 0, claim: '10000000', pending: false },
        { account: 'b.testnet', funded: true, commitment: null, revealed: 2, claim: '0', pending: false }
      ]
    }
    expect(matchEconomy(match)).toEqual({ funded: 10000000n, held: 10000000n, claimable: 10000000n, pending: 0n, paid: 0n })
    match.players[0].claim = '0'
    match.players[0].pending = true
    expect(matchEconomy(match)).toEqual({ funded: 10000000n, held: 10000000n, claimable: 0n, pending: 10000000n, paid: 0n })
    match.players[0].pending = false
    expect(matchEconomy(match).paid).toBe(10000000n)
    match.phase = 'Cancelled'
    match.winner = null
    match.players[1].claim = '5000000'
    expect(matchEconomy(match).paid).toBe(5000000n)
  })
  test('uses integer PCC base units', () => {
    expect(amount('12.000001')).toBe('12000001'); expect(pcc('12000001')).toBe('12.000001')
    for (const value of ['0','-1','1e3','1.1234567']) expect(()=>amount(value)).toThrow()
  })
  test('only accepts a fully used stake from a resolved token transfer', () => {
    expect(() => confirmStakeTransfer('5000000', '5000000')).not.toThrow()
    expect(() => confirmStakeTransfer('0', '5000000')).toThrow('did not accept')
    expect(() => confirmStakeTransfer('2500000', '5000000')).toThrow('did not accept')
    for (const value of [null, undefined, 5000000, 'not-a-number']) {
      expect(() => confirmStakeTransfer(value, '5000000')).toThrow('uncertain')
    }
  })
})
