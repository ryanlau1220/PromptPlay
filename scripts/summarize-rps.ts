import assert from 'node:assert/strict'
import { GAME, matchEconomy, pcc, type Match } from '../apps/web/src/lib/game'

const endpoint = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com'
async function view(method: string, args: object, blockId?: string) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      jsonrpc: '2.0', id: method, method: 'query',
      params: {
        request_type: 'call_function', account_id: GAME, method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
        ...(blockId ? { block_id: blockId } : { finality: 'final' })
      }
    })
  })
  assert.ok(response.ok, `RPC returned HTTP ${response.status}`)
  const data = await response.json() as { result?: { result: number[]; block_hash: string; block_height: number }; error?: unknown }
  assert.ok(data.result, `RPC query failed: ${JSON.stringify(data.error)}`)
  if (blockId) assert.equal(data.result.block_hash, blockId)
  return { ...data.result, value: JSON.parse(Buffer.from(data.result.result).toString()) as unknown }
}

const snapshot = await view('get_match_count', {})
const count = BigInt(String(snapshot.value))
const limit = BigInt(process.argv[2] ?? '100')
assert.ok(limit > 0n && limit <= 1000n, 'Limit must be between 1 and 1,000')
const start = count > limit ? count - limit : 0n
let completed = 0, cancelled = 0, deposited = 0n, unsettled = 0n, paid = 0n
for (let index = start; index < count; index += 5n) {
  const length = Number(count - index < 5n ? count - index : 5n)
  const ids = Array.from({ length }, (_, offset) => (index + BigInt(offset)).toString())
  const page = await Promise.all(ids.map(async id => {
    const { value } = await view('get_match', { match_id: id }, snapshot.block_hash)
    const match = value as Match | null
    assert.equal(match?.id, id, `Missing match ${id}`)
    return match as Match
  }))
  for (const match of page) {
    completed += Number(match.phase === 'Completed')
    cancelled += Number(match.phase === 'Cancelled')
    const economy = matchEconomy(match)
    deposited += economy.funded
    unsettled += economy.held
    paid += economy.paid
  }
}
assert.equal(deposited, unsettled + paid)
console.log(JSON.stringify({
  contract: GAME,
  blockHeight: snapshot.block_height,
  blockHash: snapshot.block_hash,
  allMatchesCovered: start === 0n,
  firstMatchId: count > 0n ? start.toString() : null,
  matchesRead: (count - start).toString(),
  completed,
  cancelled,
  depositedPcc: pcc(deposited.toString()),
  unsettledPcc: pcc(unsettled.toString()),
  paidPccIncludingRefunds: pcc(paid.toString())
}, null, 2))
