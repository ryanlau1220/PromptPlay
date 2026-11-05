import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { GatewayKeys } from '../src/keys'
test('keys are stored hashed, scoped to accounts, and revocable',()=>{
  const db=new Database(':memory:');const keys=new GatewayKeys(db);const created=keys.create('alice.testnet',100)
  expect(keys.authenticate(created.key)?.account_id).toBe('alice.testnet')
  expect(JSON.stringify(db.query('SELECT * FROM gateway_keys').all())).not.toContain(created.key)
  expect(keys.revoke('bob.testnet',created.id)).toBe(false)
  expect(keys.revoke('alice.testnet',created.id)).toBe(true)
  expect(keys.authenticate(created.key)).toBeNull()
})
