import assert from 'node:assert/strict'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Account, getTransactionLastResult, JsonRpcProvider, KeyPairSigner, type KeyPairString } from 'near-api-js'
import { base64, commitment, confirmStakeTransfer, GAME, TOKEN, type Match } from '../../web/src/lib/game'

// Operator-only integration test: two independently signed Testnet accounts, no browser wallets.
const paths = [process.env.TESTNET_PLAYER_A_KEY, process.env.TESTNET_PLAYER_B_KEY]
const ids = [process.env.TESTNET_PLAYER_A, process.env.TESTNET_PLAYER_B]
if (paths.some(path => !path)) throw new Error('Set TESTNET_PLAYER_A_KEY and TESTNET_PLAYER_B_KEY to separate Testnet credential files.')
if (ids.some(id => !id?.endsWith('.testnet')) || ids[0] === ids[1]) throw new Error('Set TESTNET_PLAYER_A and TESTNET_PLAYER_B to distinct Testnet accounts.')
const players = ids as [string, string]
const creds = await Promise.all(paths.map(path => Bun.file(path!).json() as Promise<{ private_key: string }>))
const rpc = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com' })
if (await rpc.getNetworkId() !== 'testnet') throw new Error('RPC is not NEAR Testnet.')
const accounts = creds.map((credential, index) => new Account(players[index]!, rpc, KeyPairSigner.fromSecretKey(credential.private_key as KeyPairString)))
const stake = '1000000'
const outcome = process.env.TESTNET_MATCH_OUTCOME || 'win'
if (outcome !== 'win' && outcome !== 'tie') throw new Error('TESTNET_MATCH_OUTCOME must be win or tie.')
const view = <T>(contractId: string, method: string, args: Record<string, unknown>) => rpc.callFunction({ contractId, method, args }) as Promise<T>
for (const id of players) {
  assert.ok(await view(TOKEN, 'storage_balance_of', { account_id: id }), `${id} is not registered for PCC`)
  assert.ok(BigInt(await view<string>(TOKEN, 'ft_balance_of', { account_id: id })) >= BigInt(stake), `${id} needs at least 1 PCC`)
}
const before = await Promise.all(players.map(account_id => view<string>(TOKEN, 'ft_balance_of', { account_id })))
const secrets = players.map(() => base64(crypto.getRandomValues(new Uint8Array(32))))
const run = randomUUID(), tracePath = `tmp/testnet-match-${run}.json`, secretPath = `tmp/testnet-match-${run}.secrets.json`
await mkdir('tmp', { recursive: true })
const trace: { network: string; players: string[]; stake: string; outcome: string; before: string[]; matchId?: string; pendingStep?: string; transactions: { step: string; hash: string }[]; status: string; after?: string[]; error?: string } = { network: 'testnet', players, stake, outcome, before, transactions: [], status: 'running' }
async function save() { await writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`, { mode: 0o600 }) }
await writeFile(secretPath, JSON.stringify({ players, secrets }), { mode: 0o600 })
await save()
async function call(index: number, step: string, contractId: string, methodName: string, args: object, deposit: bigint) {
  trace.pendingStep = step; await save()
  const outcome = await accounts[index]!.callFunctionRaw({ contractId, methodName, args, gas: 100000000000000n, deposit, waitUntil: 'FINAL' })
  trace.transactions.push({ step, hash: outcome.transaction.hash }); await save()
  assert.equal(outcome.final_execution_status, 'FINAL', `${step} is not final`)
  assert.ok(outcome.status && typeof outcome.status === 'object' && 'SuccessValue' in outcome.status, `${step} failed`)
  delete trace.pendingStep; await save()
  return getTransactionLastResult(outcome)
}
try {
  const created = await call(0, 'create', GAME, 'create_match', { opponent: players[1], stake }, 10000000000000000000000n)
  const id = String(created)
  assert.match(id, /^\d+$/, 'Match ID unavailable; inspect create transaction before retrying')
  trace.matchId = id; await save()
  await writeFile(secretPath, JSON.stringify({ matchId: id, players, secrets }), { mode: 0o600 })
  for (let i = 0; i < 2; i++) {
    const used = await call(i, `fund-${i}`, TOKEN, 'ft_transfer_call', { receiver_id: GAME, amount: stake, memo: null, msg: id }, 1n)
    confirmStakeTransfer(used, stake)
  }
  const choices = [0, outcome === 'tie' ? 0 : 2]
  for (let i = 0; i < 2; i++) {
    const bytes = Uint8Array.from(atob(secrets[i]!), char => char.charCodeAt(0))
    const hash = await commitment(players[i]!, id, choices[i]!, bytes)
    await call(i, `commit-${i}`, GAME, 'commit_move', { match_id: id, commitment: hash }, 0n)
  }
  for (let i = 0; i < 2; i++) await call(i, `reveal-${i}`, GAME, 'reveal_move', { match_id: id, choice: choices[i], secret: secrets[i] }, 0n)
  let match = await view<Match>(GAME, 'get_match', { match_id: id })
  assert.equal(match.phase, 'Completed'); assert.equal(match.winner, outcome === 'tie' ? null : players[0])
  assert.equal(match.players[0].claim, outcome === 'tie' ? stake : '2000000')
  if (outcome === 'tie') assert.equal(match.players[1].claim, stake)
  for (const i of outcome === 'tie' ? [0, 1] : [0]) {
    const paid = await call(i, `claim-${i}`, GAME, 'claim_payout', { match_id: id }, 1n)
    assert.equal(paid, true, 'Payout callback failed; inspect claim state')
  }
  match = await view<Match>(GAME, 'get_match', { match_id: id })
  assert.ok(match.players.every(player => player.claim === '0' && !player.pending))
  trace.after = await Promise.all(players.map(account_id => view<string>(TOKEN, 'ft_balance_of', { account_id })))
  assert.equal(BigInt(trace.after[0]!) - BigInt(before[0]!), outcome === 'tie' ? 0n : BigInt(stake))
  assert.equal(BigInt(trace.after[1]!) - BigInt(before[1]!), outcome === 'tie' ? 0n : -BigInt(stake))
  trace.status = 'passed'; await save(); await unlink(secretPath)
  console.log(`Testnet match ${id} passed. Trace: ${tracePath}`)
} catch (error) {
  trace.status = 'needs-reconciliation'; trace.error = error instanceof Error ? error.message : String(error); await save()
  console.error(`Test incomplete. Inspect ${tracePath} and ${secretPath} before taking further action; do not retry an uncertain transaction blindly.`)
  throw error
}
