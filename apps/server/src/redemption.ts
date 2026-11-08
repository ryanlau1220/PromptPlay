import type { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'
import type { JsonRpcProvider } from 'near-api-js'
import type { Accounting } from './accounting'
import { inspectTransfer } from './receipt'

const PCC_PER_UNIT = 5_000_000n
const TTL_MS = 15 * 60_000
const TOKEN = 'token.ryanlau1220.testnet'
const TREASURY = 'treasury.ryanlau1220.testnet'

/** Direct Testnet transfers only. Callers must authenticate the wallet and enforce the live gate. */
export class Redemption {
  constructor(private db:Database, private ledger:Accounting, private rpc:JsonRpcProvider) {
    db.exec(`CREATE TABLE IF NOT EXISTS redemption_intents (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, amount TEXT NOT NULL, units INTEGER NOT NULL, memo TEXT NOT NULL UNIQUE, created INTEGER NOT NULL, expires INTEGER NOT NULL, receipt_id TEXT UNIQUE, tx_hash TEXT);
      CREATE TABLE IF NOT EXISTS redemption_attempts (intent_id TEXT PRIMARY KEY REFERENCES redemption_intents(id), created INTEGER NOT NULL)`)
  }
  remainingUnits() {
    const {issued}=this.db.query('SELECT COALESCE(SUM(amount),0) AS issued FROM receipts').get() as {issued:number}
    const {pending}=this.db.query('SELECT COALESCE(SUM(units),0) AS pending FROM redemption_intents WHERE receipt_id IS NULL').get() as {pending:number}
    return Math.max(0,Math.floor((this.ledger.issuanceLimit()-issued)/1_000_000)-pending)
  }
  create(account:string, units:number) {
    if (!account.endsWith('.testnet') || !Number.isSafeInteger(units) || units < 1 || units > 100) throw new Error('Invalid redemption')
    const id=randomBytes(24).toString('base64url'); const memo=`promptplay:${randomBytes(24).toString('base64url')}`
    const created=Date.now(), expires=created+TTL_MS, amount=(BigInt(units)*PCC_PER_UNIT).toString()
    this.db.transaction(()=>{
      const {issued}=this.db.query('SELECT COALESCE(SUM(amount),0) AS issued FROM receipts').get() as {issued:number}
      const {pending}=this.db.query('SELECT COALESCE(SUM(units),0) AS pending FROM redemption_intents WHERE receipt_id IS NULL').get() as {pending:number}
      if (!Number.isSafeInteger(issued + (pending + units)*1_000_000) || issued + (pending + units)*1_000_000 > this.ledger.issuanceLimit()) throw new Error('Demo funding is fully allocated')
      this.db.query('INSERT INTO redemption_intents (id,account_id,amount,units,memo,created,expires) VALUES (?,?,?,?,?,?,?)').run(id,account,amount,units,memo,created,expires)
    }).immediate()
    return {id,account,amount,units,memo,created,expires,token:TOKEN,treasury:TREASURY}
  }
  list(account:string) { return this.db.query('SELECT id, account_id, amount, units, memo, created, expires, receipt_id, tx_hash, EXISTS(SELECT 1 FROM redemption_attempts WHERE intent_id=redemption_intents.id) AS attempted FROM redemption_intents WHERE account_id=? ORDER BY created DESC LIMIT 50').all(account) }
  get(id:string, account:string) {
    return this.db.query('SELECT id, account_id, amount, units, memo, created, expires, receipt_id, tx_hash, EXISTS(SELECT 1 FROM redemption_attempts WHERE intent_id=redemption_intents.id) AS attempted FROM redemption_intents WHERE id=? AND account_id=?').get(id,account) as {id:string;account_id:string;amount:string;units:number;memo:string;created:number;expires:number;receipt_id:string|null;tx_hash:string|null;attempted:number}|null
  }
  beginTransfer(id:string,account:string) {
    this.db.transaction(()=>{
      const intent=this.get(id,account)
      if(!intent || intent.receipt_id || intent.expires-Date.now()<60_000) throw new Error('Intent is unavailable or too close to expiry')
      if(intent.attempted) throw new Error('Payment attempt already recorded; check wallet history')
      this.db.query('INSERT INTO redemption_attempts (intent_id,created) VALUES (?,?)').run(id,Date.now())
    }).immediate()
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
      const credited=this.ledger.creditReceipt(receiptId,id,account,intent.units * 1_000_000)
      this.db.query('UPDATE redemption_intents SET receipt_id=?, tx_hash=? WHERE id=? AND receipt_id IS NULL').run(receiptId,hash,id)
      return {credited,receiptId}
    }).immediate()
  }
}
