import { RequestError } from './errors'
import type { Database } from 'bun:sqlite'
import type { JsonRpcProvider } from 'near-api-js'
const TOKEN='token.ryanlau1220.testnet'
const AMOUNT='10000000'
type Transfer = (account:string,amount:string)=>Promise<string>
/** One claim per authenticated account; pending claims are never retried automatically. */
export class Faucet {
  constructor(private db:Database,private rpc:JsonRpcProvider,private transfer:Transfer,private maxClaims=1000){
    if(!Number.isSafeInteger(maxClaims)||maxClaims<1||maxClaims>1000)throw new Error('Invalid faucet limit')
    db.exec("CREATE TABLE IF NOT EXISTS faucet_claims (account_id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('pending','complete')), tx_hash TEXT, created INTEGER NOT NULL)")
  }
  status(account:string){return this.db.query('SELECT state,tx_hash,created FROM faucet_claims WHERE account_id=?').get(account) ?? null}
  async claim(account:string){
    const existing=this.status(account);if(existing)return existing
    const storage=await this.rpc.callFunction({contractId:TOKEN,method:'storage_balance_of',args:{account_id:account}})
    if(!storage)throw new RequestError('Register PCC storage before claiming', 400)
    const reserved=this.db.transaction(()=>{
      if(this.status(account))return false
      const count=this.db.query('SELECT COUNT(*) AS n FROM faucet_claims').get() as {n:number}
      if(count.n>=this.maxClaims)throw new RequestError('Faucet allocation exhausted', 409)
      this.db.query("INSERT INTO faucet_claims VALUES (?, 'pending', NULL, ?)").run(account,Date.now());return true
    }).immediate()
    if(!reserved)return this.status(account)
    // A timeout can mean the transaction executed: keep pending for manual reconciliation.
    const hash=await this.transfer(account,AMOUNT)
    this.db.query("UPDATE faucet_claims SET state='complete',tx_hash=? WHERE account_id=? AND state='pending'").run(hash,account)
    return this.status(account)
  }
}
