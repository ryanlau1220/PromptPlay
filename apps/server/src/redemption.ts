import { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'
import type { JsonRpcProvider } from 'near-api-js'
import { Accounting } from './accounting'
import { inspectTransfer } from './receipt'

const PCC_PER_UNIT = 5_000_000n
const TTL_MS = 15 * 60_000
const TOKEN = 'token.ryanlau1220.testnet'
const TREASURY = 'treasury.ryanlau1220.testnet'

/** Direct Testnet transfers only. Callers must authenticate the wallet and enforce the live gate. */
export class Redemption {
  constructor(private db:Database, private ledger:Accounting, private rpc:JsonRpcProvider) {
    db.exec(`CREATE TABLE IF NOT EXISTS redemption_intents (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, amount TEXT NOT NULL, units INTEGER NOT NULL, memo TEXT NOT NULL UNIQUE, created INTEGER NOT NULL, expires INTEGER NOT NULL, receipt_id TEXT UNIQUE, tx_hash TEXT)`)
  }
  create(account:string, units:number) {
    if (!account.endsWith('.testnet') || !Number.isSafeInteger(units) || units < 1 || units > 100) throw new Error('Invalid redemption')
    const id=randomBytes(24).toString('base64url'); const memo=`promptplay:${randomBytes(24).toString('base64url')}`
    const created=Date.now(), expires=created+TTL_MS, amount=(BigInt(units)*PCC_PER_UNIT).toString()
    this.db.query('INSERT INTO redemption_intents (id,account_id,amount,units,memo,created,expires) VALUES (?,?,?,?,?,?,?)').run(id,account,amount,units,memo,created,expires)
    return {id,account,amount,units,memo,created,expires,token:TOKEN,treasury:TREASURY}
  }
  get(id:string, account:string) {
    return this.db.query('SELECT id, account_id, amount, units, memo, created, expires, receipt_id, tx_hash FROM redemption_intents WHERE id=? AND account_id=?').get(id,account) as {id:string;account_id:string;amount:string;units:number;memo:string;created:number;expires:number;receipt_id:string|null;tx_hash:string|null}|null
  }
  async verify(id:string,account:string,hash:string) {
    const intent=this.get(id,account); if (!intent) throw new Error('Unknown intent')
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(hash)) throw new Error('Invalid transaction hash')
    if (intent.receipt_id) { if (intent.tx_hash !== hash) throw new Error('Intent already used'); return {credited:false,receiptId:intent.receipt_id} }
    if (await this.rpc.getNetworkId() !== 'testnet') throw new Error('Unexpected NEAR network')
    const result=await this.rpc.viewTransactionStatus({txHash:hash,accountId:account,waitUntil:'FINAL'})
    const receiptId=inspectTransfer(result,{transactionHash:hash,sender:account,token:TOKEN,treasury:TREASURY,amount:intent.amount,memo:intent.memo})
    const receipt=(result.receipts_outcome as Array<{id:string;block_hash:string}>).find(r=>r.id===receiptId)
    if (!receipt?.block_hash) throw new Error('Missing transfer block')
    const block=await this.rpc.viewBlock({blockId:receipt.block_hash})
    const executed=BigInt(block.header.timestamp_nanosec)
    if (executed < BigInt(intent.created)*1_000_000n || executed > BigInt(intent.expires)*1_000_000n) throw new Error('Transfer outside intent window; contact support')
    return this.db.transaction(()=>{
      const current=this.get(id,account); if (!current) throw new Error('Unknown intent')
      if (current.receipt_id) { if(current.tx_hash!==hash) throw new Error('Intent already used'); return {credited:false,receiptId:current.receipt_id} }
      const credited=this.ledger.creditReceipt(receiptId,id,account,intent.units)
      this.db.query('UPDATE redemption_intents SET receipt_id=?, tx_hash=? WHERE id=? AND receipt_id IS NULL').run(receiptId,hash,id)
      return {credited,receiptId}
    }).immediate()
  }
}
