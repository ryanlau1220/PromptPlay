import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import evidence from '../deployments/testnet.json' with { type: 'json' }

// Read-only: this checks recorded evidence and does not sign or send transactions.
const endpoint = process.env.NEAR_RPC_URL || 'https://archival-rpc.testnet.fastnear.com'
let requestId = 0
async function rpc(method, params) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
      signal: AbortSignal.timeout(30000)
    })
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 4) {
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt))
      continue
    }
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`)
    const result = await response.json()
    if (result.error) throw new Error(`RPC ${method}: ${result.error.message}`)
    return result.result
  }
  throw new Error('RPC retry limit reached')
}
function transferEvent(outcome, from, to, amount) {
  return outcome.receipts_outcome.some(receipt =>
    receipt.outcome.executor_id === evidence.computeCredit.accountId &&
    Object.hasOwn(receipt.outcome.status, 'SuccessValue') &&
    receipt.outcome.logs.some(line => {
      if (!line.startsWith('EVENT_JSON:')) return false
      const event = JSON.parse(line.slice('EVENT_JSON:'.length))
      return event.standard === 'nep141' && event.event === 'ft_transfer' &&
        event.data.some(item => item.old_owner_id === from && item.new_owner_id === to && item.amount === amount)
    })
  )
}

async function verifyMatch(recorded) {
  const query = await rpc('query', {
    request_type: 'call_function', finality: 'final', account_id: evidence.rpsGame.accountId,
    method_name: 'get_match', args_base64: Buffer.from(JSON.stringify({ match_id: recorded.id })).toString('base64')
  })
  const match = JSON.parse(Buffer.from(query.result).toString())
  assert.equal(match.id, recorded.id)
  assert.equal(match.phase, 'Completed')
  assert.equal(match.stake, recorded.stakeBaseUnits)
  assert.equal(match.winner, recorded.winner)
  assert.deepEqual(match.players.map(player => player.account), recorded.players)
  assert.ok(match.players.every(player => player.funded && player.commitment && player.revealed !== null))
  assert.ok(match.players.every(player => player.claim === '0' && !player.pending))

  const claims = recorded.winner ? [{ account: recorded.winner, hash: recorded.claimTransaction, amount: (BigInt(recorded.stakeBaseUnits) * 2n).toString() }] : recorded.players.map((account, index) => ({ account, hash: recorded.claimTransactions[index], amount: recorded.stakeBaseUnits }))
  for (const { account, hash, amount } of claims) {
    const payout = await rpc('tx', { tx_hash: hash, sender_account_id: account, wait_until: 'FINAL' })
    assert.equal(payout.final_execution_status, 'FINAL')
    assert.equal(payout.transaction.signer_id, account)
    assert.equal(payout.transaction.receiver_id, evidence.rpsGame.accountId)
    assert.equal(Buffer.from(payout.status.SuccessValue, 'base64').toString(), 'true', 'Payout callback must succeed')
    const call = payout.transaction.actions.find(action => action.FunctionCall?.method_name === 'claim_payout')?.FunctionCall
    assert.ok(call, 'Missing claim_payout call')
    assert.equal(JSON.parse(Buffer.from(call.args, 'base64').toString()).match_id, recorded.id)
    assert.ok(transferEvent(payout, evidence.rpsGame.accountId, account, amount), 'Missing successful PCC payout receipt')
  }
  return { id: match.id, players: recorded.players, stakeBaseUnits: match.stake, winner: match.winner, claimTransactions: claims.map(claim => claim.hash), blockHeight: query.block_height }
}

async function verifyCode(contract, localPath) {
  const result = await rpc('query', { request_type: 'view_code', finality: 'final', account_id: contract.accountId })
  const digest = bytes => createHash('sha256').update(bytes).digest('hex')
  const onChain = digest(Buffer.from(result.code_base64, 'base64'))
  assert.equal(onChain, contract.wasmSha256, `Deployed code mismatch for ${contract.accountId}`)
  let localMatches = null
  try { localMatches = digest(await readFile(new URL(localPath, import.meta.url))) === onChain }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  return { account: contract.accountId, sha256: onChain, localBuildMatches: localMatches }
}

try {
  const status = await rpc('status', [])
  assert.equal(status.chain_id, 'testnet', 'RPC must be connected to NEAR Testnet')
  const contracts = [
    await verifyCode(evidence.computeCredit, '../contracts/compute-credit/target/near/compute_credit.wasm'),
    await verifyCode(evidence.rpsGame, '../contracts/rps-game/target/near/rps_game.wasm')
  ]
  const matches = []
  for (const match of [evidence.rpsGame.verifiedMatch, evidence.rpsGame.meteorBrowserMatch, evidence.rpsGame.meteorBrowserTie, evidence.rpsGame.journeyMatch, evidence.rpsGame.automatedMeteorMatch, evidence.rpsGame.automatedMeteorTie, evidence.rpsGame.automatedMeteorRestart, evidence.rpsGame.automatedBrowserRedemption]) matches.push(await verifyMatch(match))

  const payments = [evidence.redemptionTreasury.openCodeGatewaySmokeTest, evidence.redemptionTreasury.localOperatorGatewaySmokeTest, evidence.redemptionTreasury.journeyPayment, evidence.redemptionTreasury.browserRecoveryPayment]
  for (const payment of payments) {
    const sender = payment.account ?? evidence.rpsGame.verifiedMatch.winner
    const tx = await rpc('tx', { tx_hash: payment.transferTransaction, sender_account_id: sender, wait_until: 'FINAL' })
    assert.equal(tx.final_execution_status, 'FINAL')
    assert.ok(Object.hasOwn(tx.status, 'SuccessValue'))
    assert.equal(tx.transaction.signer_id, sender)
    assert.equal(tx.transaction.receiver_id, evidence.computeCredit.accountId)
    assert.ok(transferEvent(tx, sender, evidence.redemptionTreasury.accountId, payment.amountBaseUnits), 'Missing successful PCC treasury transfer receipt')
  }

  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), network: status.chain_id, contracts, matches,
    operatorPayments: payments.map(payment => ({ transaction: payment.transferTransaction, amountBaseUnits: payment.amountBaseUnits })),
    limitations: 'Read-only chain evidence; does not reproduce browser wallet interactions, infer linkage between match and payment, or verify a live inference request.' }, null, 2))
} catch (error) {
  console.error('Testnet evidence verification failed:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
