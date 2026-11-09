import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Account, getTransactionLastResult, JsonRpcProvider, KeyPairSigner, type KeyPairString } from 'near-api-js'
import { confirmStakeTransfer, TOKEN } from '../../web/src/lib/game'

const contract = 'arcade.ryanlau1220.testnet',
  stake = '1000000'
const ids = [process.env.TESTNET_PLAYER_A, process.env.TESTNET_PLAYER_B],
  paths = [process.env.TESTNET_PLAYER_A_KEY, process.env.TESTNET_PLAYER_B_KEY]
if (ids.some((id) => !id?.endsWith('.testnet')) || ids[0] === ids[1] || paths.some((path) => !path))
  throw new Error('Set two distinct Testnet players and credential paths')
const players = ids as [string, string]
const rpc = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com' })
if ((await rpc.getNetworkId()) !== 'testnet') throw new Error('RPC is not Testnet')
const accounts = await Promise.all(
  paths.map(async (path, i) => {
    assert(path)
    const c = (await Bun.file(path).json()) as { private_key: KeyPairString }
    return new Account(players[i], rpc, KeyPairSigner.fromSecretKey(c.private_key))
  }),
)
const view = <T>(contractId: string, method: string, args: Record<string, unknown>) =>
  rpc.callFunction({ contractId, method, args }) as Promise<T>
for (const id of players) {
  assert.ok(await view(TOKEN, 'storage_balance_of', { account_id: id }))
  assert.ok(BigInt(await view<string>(TOKEN, 'ft_balance_of', { account_id: id })) >= BigInt(stake))
}
const before = await Promise.all(players.map((account_id) => view<string>(TOKEN, 'ft_balance_of', { account_id })))
const tracePath = `tmp/testnet-arcade-${randomUUID()}.json`
const trace: {
  network: string
  contract: string
  players: string[]
  before: string[]
  after?: string[]
  matchId?: string
  pending?: string
  transactions: Array<{ step: string; hash: string }>
  status: string
} = { network: 'testnet', contract, players, before, transactions: [], status: 'running' }
await mkdir('tmp', { recursive: true })
const save = () => writeFile(tracePath, JSON.stringify(trace, null, 2), { mode: 0o600 })
await save()
async function call(i: number, step: string, contractId: string, methodName: string, args: object, deposit: bigint) {
  trace.pending = step
  await save()
  const result = await accounts[i].callFunctionRaw({
    contractId,
    methodName,
    args,
    gas: 100_000_000_000_000n,
    deposit,
    waitUntil: 'FINAL',
  })
  trace.transactions.push({ step, hash: result.transaction.hash })
  await save()
  assert.equal(result.final_execution_status, 'FINAL')
  assert.ok(result.status && typeof result.status === 'object' && 'SuccessValue' in result.status)
  delete trace.pending
  await save()
  return getTransactionLastResult(result)
}
try {
  const id = String(
    await call(
      0,
      'create',
      contract,
      'create_match',
      { game: 'tic-tac-toe', opponent: players[1], stake },
      10_000_000_000_000_000_000_000n,
    ),
  )
  assert.match(id, /^\d+$/)
  trace.matchId = id
  await save()
  for (let i = 0; i < 2; i++)
    confirmStakeTransfer(
      await call(
        i,
        `fund-${i}`,
        TOKEN,
        'ft_transfer_call',
        { receiver_id: contract, amount: stake, memo: null, msg: id },
        1n,
      ),
      stake,
    )
  for (let i = 0; i < 2; i++) await call(i, `vote-${i}`, contract, 'agree_result', { match_id: id, outcome: 'Tie' }, 0n)
  const match = await view<{ phase: string; outcome: string; players: Array<{ claim: string; pending: boolean }> }>(
    contract,
    'get_match',
    { match_id: id },
  )
  assert.equal(match.phase, 'Completed')
  assert.equal(match.outcome, 'Tie')
  assert.deepEqual(
    match.players.map((p) => p.claim),
    [stake, stake],
  )
  for (let i = 0; i < 2; i++)
    assert.equal(await call(i, `claim-${i}`, contract, 'claim_payout', { match_id: id }, 1n), true)
  const settled = await view<typeof match>(contract, 'get_match', { match_id: id })
  assert.ok(settled.players.every((p) => p.claim === '0' && !p.pending))
  trace.after = await Promise.all(players.map((account_id) => view<string>(TOKEN, 'ft_balance_of', { account_id })))
  assert.deepEqual(trace.after, before)
  trace.status = 'passed'
  await save()
  console.log(`Shared settlement match ${id} passed. Trace: ${tracePath}`)
} catch (error) {
  trace.status = 'needs-reconciliation'
  await save()
  console.error(`Inspect ${tracePath} and chain state before retrying.`)
  throw error
}
