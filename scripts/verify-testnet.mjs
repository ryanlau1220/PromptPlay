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
      signal: AbortSignal.timeout(15000)
    }).catch(error => {
      if (attempt === 4) throw new Error(`RPC ${method}: ${error.message}`, { cause: error })
      return null
    })
    if (response === null) {
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt))
      continue
    }
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 4) {
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt))
      continue
    }
    if (!response.ok) throw new Error(`RPC ${method} returned HTTP ${response.status}`)
    const result = await response.json()
    if (result.error) throw new Error(`RPC ${method}: ${result.error.message}`)
    return result.result
  }
  throw new Error('RPC retry limit reached')
}
function transferEvent(outcome, from, to, amount, allowForwarded = false) {
  return outcome.receipts_outcome.some(receipt =>
    receipt.outcome.executor_id === evidence.computeCredit.accountId &&
    (Object.hasOwn(receipt.outcome.status, 'SuccessValue') || (allowForwarded && Object.hasOwn(receipt.outcome.status, 'SuccessReceiptId'))) &&
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

async function verifyArcadeMatch(recorded) {
  const contract = evidence.arcadeSettlement.accountId
  const query = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: contract,
    method_name: 'get_match', args_base64: Buffer.from(JSON.stringify({ match_id: recorded.id })).toString('base64') })
  const match = JSON.parse(Buffer.from(query.result).toString())
  assert.equal(match.id, recorded.id); assert.equal(match.phase, 'Completed'); assert.equal(match.game, recorded.game)
  assert.equal(match.stake, recorded.stakeBaseUnits); assert.equal(match.outcome, recorded.outcome)
  assert.deepEqual(match.players.map(player => player.account), recorded.players)
  assert.ok(match.players.every(player => player.funded && player.vote === recorded.outcome && player.claim === '0' && !player.pending))
  for (const [index, account] of recorded.players.entries()) {
    const payout = await rpc('tx', { tx_hash: recorded.payoutTransactions[index], sender_account_id: account, wait_until: 'FINAL' })
    assert.equal(payout.final_execution_status, 'FINAL'); assert.equal(payout.transaction.receiver_id, contract)
    assert.equal(Buffer.from(payout.status.SuccessValue, 'base64').toString(), 'true')
    assert.ok(transferEvent(payout, contract, account, recorded.stakeBaseUnits), 'Missing shared arcade payout')
  }
  return { id: match.id, players: recorded.players, outcome: match.outcome, blockHeight: query.block_height }
}

async function verifyEscrow() {
  const escrow = evidence.redemptionEscrow
  const escrowQuery = await rpc('query', {
    request_type: 'call_function', finality: 'final', account_id: escrow.contract,
    method_name: 'settings', args_base64: Buffer.from('{}').toString('base64')
  })
  const settings = JSON.parse(Buffer.from(escrowQuery.result).toString())
  for (const field of ['token', 'owner', 'treasury', 'cap']) assert.equal(settings[field], escrow[field])
  const allocated = BigInt(settings.allocated)
  assert.ok(allocated >= 0n && allocated <= BigInt(settings.cap), 'Invalid escrow allocation')
  return { cap: settings.cap, allocated: settings.allocated, remaining: (BigInt(settings.cap) - allocated).toString() }
}

async function verifyBrowserJourney(journey) {
  const view = async (account, method, args) => {
    const result = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: account,
      method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') })
    return JSON.parse(Buffer.from(result.result).toString())
  }
  const match = await view(journey.gameContract, 'get_match', { match_id: journey.matchId })
  assert.equal(match.id, journey.matchId)
  assert.equal(match.phase, 'Completed')
  assert.equal(match.stake, journey.stakeBaseUnits)
  assert.equal(match.winner, journey.winner)
  assert.deepEqual(match.wins, [2, 0])
  assert.deepEqual(match.players.map(player => player.account), journey.players)
  assert.ok(match.players.every(player => player.funded && player.commitment && player.revealed !== null && player.claim === '0' && !player.pending))

  const payout = await rpc('tx', { tx_hash: journey.payoutTransaction, sender_account_id: journey.winner, wait_until: 'FINAL' })
  assert.equal(payout.final_execution_status, 'FINAL')
  assert.equal(payout.transaction.signer_id, journey.winner)
  assert.equal(payout.transaction.receiver_id, journey.gameContract)
  assert.equal(Buffer.from(payout.status.SuccessValue, 'base64').toString(), 'true')
  const claim = payout.transaction.actions.find(action => action.FunctionCall?.method_name === 'claim_payout')?.FunctionCall
  assert.ok(claim, 'Missing journey claim_payout call')
  assert.equal(JSON.parse(Buffer.from(claim.args, 'base64').toString()).match_id, journey.matchId)
  assert.ok(transferEvent(payout, journey.gameContract, journey.winner, (BigInt(journey.stakeBaseUnits) * 2n).toString()), 'Missing journey payout receipt')

  const payment = await rpc('tx', { tx_hash: journey.redemptionTransaction, sender_account_id: journey.winner, wait_until: 'FINAL' })
  assert.equal(payment.final_execution_status, 'FINAL')
  assert.ok(Object.hasOwn(payment.status, 'SuccessValue'))
  assert.equal(payment.transaction.signer_id, journey.winner)
  assert.equal(payment.transaction.receiver_id, evidence.computeCredit.accountId)
  const transfer = payment.transaction.actions.find(action => action.FunctionCall?.method_name === 'ft_transfer_call')?.FunctionCall
  assert.ok(transfer, 'Missing journey redemption transfer')
  const args = JSON.parse(Buffer.from(transfer.args, 'base64').toString())
  assert.equal(args.receiver_id, journey.redemptionEscrow)
  assert.equal(args.amount, journey.redemptionAmountBaseUnits)
  assert.equal(args.msg, journey.redemptionDepositId)
  assert.equal(JSON.parse(Buffer.from(payment.status.SuccessValue, 'base64').toString()), journey.redemptionAmountBaseUnits)
  assert.ok(transferEvent(payment, journey.winner, journey.redemptionEscrow, journey.redemptionAmountBaseUnits, true), 'Missing journey deposit receipt')
  const deposit = await view(journey.redemptionEscrow, 'get_deposit', { account: journey.winner, id: journey.redemptionDepositId })
  assert.equal(deposit.account, journey.winner)
  assert.equal(deposit.amount, journey.redemptionAmountBaseUnits)
  assert.equal(deposit.units, '1')
  assert.equal(deposit.approved, true)
  assert.equal(deposit.status, 'Consumed')
  return { matchId: match.id, winner: match.winner, payoutTransaction: journey.payoutTransaction,
    redemptionTransaction: journey.redemptionTransaction, redemptionStatus: deposit.status }
}

try {
  const status = await rpc('status', [])
  assert.equal(status.chain_id, 'testnet', 'RPC must be connected to NEAR Testnet')
  if (process.argv.includes('--escrow-only')) {
    const escrow = evidence.redemptionEscrow
    const contract = await verifyCode({
      accountId: escrow.contract, wasmSha256: escrow.sha256
    }, '../contracts/redemption-escrow/target/deployed/redemption_escrow.wasm')
    console.log(JSON.stringify({ network: status.chain_id, contract, escrowCapacity: await verifyEscrow() }, null, 2))
  } else {
    const contracts = await Promise.all([
      verifyCode(evidence.computeCredit, '../contracts/compute-credit/target/reproducible/compute_credit.wasm'),
      verifyCode(evidence.rpsGame, '../contracts/rps-game/target/reproducible/rps_game.wasm'),
      verifyCode(evidence.multiRoundRps, '../contracts/rps-game/target/deployed/rps_game.wasm'),
      verifyCode(evidence.arcadeSettlement, '../contracts/arcade-settlement/target/deployed/arcade_settlement.wasm'),
      verifyCode({
        accountId: evidence.redemptionEscrow.contract,
        wasmSha256: evidence.redemptionEscrow.sha256
      }, '../contracts/redemption-escrow/target/deployed/redemption_escrow.wasm')
    ])
    const recordedMatches = [evidence.rpsGame.verifiedMatch, evidence.rpsGame.meteorBrowserMatch, evidence.rpsGame.meteorBrowserTie, evidence.rpsGame.journeyMatch, evidence.rpsGame.automatedMeteorMatch, evidence.rpsGame.automatedMeteorTie, evidence.rpsGame.automatedMeteorRestart, evidence.rpsGame.automatedBrowserRedemption, evidence.rpsGame.upgradedBrowserMatch]
    const matches = []
    for (let offset = 0; offset < recordedMatches.length; offset += 3) {
      matches.push(...await Promise.all(recordedMatches.slice(offset, offset + 3).map(verifyMatch)))
    }
    const multi = evidence.multiRoundRps
    const multiQuery = await rpc('query', {request_type:'call_function',finality:'final',account_id:multi.accountId,method_name:'get_match',args_base64:Buffer.from(JSON.stringify({match_id:multi.pushVerificationMatch})).toString('base64')})
    const multiMatch = JSON.parse(Buffer.from(multiQuery.result).toString())
    assert.equal(multiMatch.phase,'Completed');assert.deepEqual(multiMatch.wins,[2,0]);assert.equal(multiMatch.winner,multiMatch.players[0].account)
    assert.ok(multiMatch.players.every(player=>player.claim==='0' && !player.pending))
    const multiPayout=await rpc('tx',{tx_hash:multi.pushVerificationPayout,sender_account_id:multiMatch.winner,wait_until:'FINAL'})
    assert.equal(multiPayout.final_execution_status,'FINAL');assert.equal(multiPayout.transaction.receiver_id,multi.accountId)
    assert.ok(transferEvent(multiPayout,multi.accountId,multiMatch.winner,(BigInt(multiMatch.stake)*2n).toString()),'Missing multi-round payout')

    const payments = [evidence.redemptionTreasury.openCodeGatewaySmokeTest, evidence.redemptionTreasury.localOperatorGatewaySmokeTest, evidence.redemptionTreasury.journeyPayment, evidence.redemptionTreasury.browserRecoveryPayment, evidence.redemptionTreasury.upgradedBrowserPayment]
    for (const payment of payments) {
      const sender = payment.account ?? evidence.rpsGame.verifiedMatch.winner
      const tx = await rpc('tx', { tx_hash: payment.transferTransaction, sender_account_id: sender, wait_until: 'FINAL' })
      assert.equal(tx.final_execution_status, 'FINAL')
      assert.ok(Object.hasOwn(tx.status, 'SuccessValue'))
      assert.equal(tx.transaction.signer_id, sender)
      assert.equal(tx.transaction.receiver_id, evidence.computeCredit.accountId)
      assert.ok(transferEvent(tx, sender, evidence.redemptionTreasury.accountId, payment.amountBaseUnits), 'Missing successful PCC treasury transfer receipt')
    }

    const arcadeMatches = await Promise.all([evidence.arcadeSettlement.sdkVerifiedMatch, evidence.arcadeSettlement.browserVerifiedMatch].map(verifyArcadeMatch))
    const browserJourney = await verifyBrowserJourney(evidence.browserJourneyAudit)
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), network: status.chain_id, contracts, matches, arcadeMatches, multiRoundMatch:multiMatch.id, browserJourney, escrowCapacity: await verifyEscrow(),
      operatorPayments: payments.map(payment => ({ transaction: payment.transferTransaction, amountBaseUnits: payment.amountBaseUnits })),
      limitations: 'Read-only chain evidence verifies the recorded match, payout and escrow state; it does not reproduce browser interactions, trace specific token units between transactions, or verify off-chain inference usage.' }, null, 2))
  }
} catch (error) {
  console.error('Testnet evidence verification failed:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
