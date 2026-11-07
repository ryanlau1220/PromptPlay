import { describe, expect, test } from 'bun:test'
import { amount, commitment, confirmStakeTransfer, pcc } from '../src/lib/game'
describe('game client encoding', () => {
  test('matches the Rust commitment byte encoding', async () => {
    expect(await commitment('player.testnet','42',2,Uint8Array.from({length:32},(_,i)=>i))).toBe('Oalzh2rozyM3V6tAIU3k/QWytN4KcaWcoxq8YoFv1cs=')
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
