import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { JsonRpcProvider } from 'near-api-js'
import { WalletAuth } from '../src/auth'
test('challenge is consumed once and session is revocable', async () => {
  const db = new Database(':memory:'); let calls=0
  const auth = new WalletAuth(db,new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),async ()=>{calls++})
  const c = auth.challenge(); const input={challengeId:c.id,accountId:'alice.testnet',publicKey:`ed25519:${'1'.repeat(32)}`,signature:Buffer.alloc(64).toString('base64')}
  const session = await auth.signIn(input)
  expect(auth.account(session.token)).toBe('alice.testnet'); expect(calls).toBe(1)
  await expect(auth.signIn(input)).rejects.toThrow('used')
  expect(JSON.stringify(db.query('SELECT * FROM auth_sessions').all())).not.toContain(session.token)
  auth.revoke(session.token); expect(auth.account(session.token)).toBeNull()
})
test('invalid signatures never create a session', async () => {
  const db = new Database(':memory:'); const auth = new WalletAuth(db,new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),async ()=>{throw new Error('invalid')})
  const c=auth.challenge(); await expect(auth.signIn({challengeId:c.id,accountId:'alice.testnet',publicKey:`ed25519:${'1'.repeat(32)}`,signature:Buffer.alloc(64).toString('base64')})).rejects.toThrow()
  expect(db.query('SELECT * FROM auth_sessions').all()).toHaveLength(0)
})

test('verifies a real NEP-413 signature against a full-access key', async () => {
  const { Account, KeyPair, KeyPairSigner } = await import('near-api-js')
  const { signMessage } = await import('near-api-js/nep413')
  const key = KeyPair.fromRandom('ed25519')
  const provider = {viewAccessKey:async()=>({permission:'FullAccess'})} as unknown as JsonRpcProvider
  const auth = new WalletAuth(new Database(':memory:'),provider)
  const c = auth.challenge(); const signer = new Account('alice.testnet',provider,new KeyPairSigner(key))
  const signed = await signMessage({signerAccount:signer,payload:{message:c.message,recipient:c.recipient,nonce:Uint8Array.from(Buffer.from(c.nonce,'base64'))}})
  const session = await auth.signIn({challengeId:c.id,accountId:'alice.testnet',publicKey:key.getPublicKey().toString(),signature:Buffer.from(signed.signature).toString('base64')})
  expect(auth.account(session.token)).toBe('alice.testnet')
})
