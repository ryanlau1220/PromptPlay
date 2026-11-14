import type { Database } from 'bun:sqlite'
import type { JsonRpcProvider } from 'near-api-js'

type Candidate = {transaction_hash:string;receipt_id:string;predecessor_account_id?:string;receipt_outcome?:{executor_account_id?:string}}
type Transaction = {signer_account_id:string}
type MatchEvent = {standard:string;version:string;event:string;data:Array<{sequence:string;match:{id:string;players:Array<{account:string}>}}>}

/** NearBlocks discovers receipts; the archival NEAR RPC verifies every finalized event. */
export class MatchEvents {
  constructor(private db:Database,private rpc:JsonRpcProvider,private contract:string,private source='https://api-testnet.nearblocks.io'){
    db.exec(`CREATE TABLE IF NOT EXISTS rps_events (match_id TEXT NOT NULL, sequence INTEGER NOT NULL, event TEXT NOT NULL, payload TEXT NOT NULL, tx_hash TEXT NOT NULL, PRIMARY KEY(match_id,sequence)); CREATE TABLE IF NOT EXISTS rps_indexed_receipts(receipt_id TEXT PRIMARY KEY); DROP TABLE IF EXISTS rps_index_cursor; CREATE TABLE IF NOT EXISTS rps_backfill_cursor(id INTEGER PRIMARY KEY CHECK(id=1), cursor TEXT); INSERT OR IGNORE INTO rps_backfill_cursor VALUES (1,NULL);`)
  }
  async sync(){
    const {cursor}=this.db.query('SELECT cursor FROM rps_backfill_cursor WHERE id=1').get() as {cursor:string|null}
    const response=await fetch(`${this.source}/v1/account/${encodeURIComponent(this.contract)}/txns?per_page=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,{signal:AbortSignal.timeout(15000)})
    if(!response.ok)throw new Error('History index is unavailable')
    const data=await response.json() as {txns?:Candidate[];cursor?:string|null}
    if(!Array.isArray(data.txns))throw new Error('Invalid history response')
    if(data.cursor != null && (typeof data.cursor!=='string' || data.cursor.length>1024))throw new Error('Invalid history cursor')
    for(const row of data.txns){
      if(!/^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(row.receipt_id)||!/^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(row.transaction_hash))throw new Error('Invalid history candidate')
      if(this.db.query('SELECT 1 FROM rps_indexed_receipts WHERE receipt_id=?').get(row.receipt_id))continue
      if(row.receipt_outcome?.executor_account_id && row.receipt_outcome.executor_account_id!==this.contract){this.db.query('INSERT OR IGNORE INTO rps_indexed_receipts VALUES (?)').run(row.receipt_id);continue}
      let signer=row.predecessor_account_id
      let result:Awaited<ReturnType<JsonRpcProvider['viewTransactionStatus']>>|undefined
      if(signer && signer!==this.contract && signer!=='token.ryanlau1220.testnet'){
        try{result=await this.rpc.viewTransactionStatus({txHash:row.transaction_hash,accountId:signer,waitUntil:'FINAL'})}catch{/* Cross-contract calls need the transaction signer. */}
      }
      if(!result || result.transaction.signer_id!==signer){
        const details=await fetch(`${this.source}/v1/txns/${encodeURIComponent(row.transaction_hash)}`,{signal:AbortSignal.timeout(15000)})
        if(!details.ok)throw new Error('History transaction is unavailable')
        const tx=await details.json() as {txns?:Transaction[]}
        signer=tx.txns?.[0]?.signer_account_id
        if(!signer || !/^[a-z0-9._-]{2,64}$/.test(signer))throw new Error('Invalid history transaction')
        result=await this.rpc.viewTransactionStatus({txHash:row.transaction_hash,accountId:signer,waitUntil:'FINAL'})
      }
      if(result.final_execution_status!=='FINAL' || result.transaction.hash!==row.transaction_hash || result.transaction.signer_id!==signer)throw new Error('History transaction is not finalized')
      const receipt=result.receipts_outcome.find(outcome=>outcome.id===row.receipt_id)
      if(!receipt || receipt.outcome.executor_id!==this.contract || !receipt.outcome.status || typeof receipt.outcome.status!=='object' || !('SuccessValue' in receipt.outcome.status || 'SuccessReceiptId' in receipt.outcome.status))throw new Error('History receipt is not finalized')
      this.record(row.transaction_hash,receipt)
    }
    this.db.query('UPDATE rps_backfill_cursor SET cursor=? WHERE id=1').run(data.txns.length===25 ? data.cursor ?? null : null)
  }
  async ingest(hash:string,signer:string){
    if(!/^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(hash)||!/^[a-z0-9._-]{2,64}$/.test(signer))throw new Error('Invalid transaction')
    const result=await this.rpc.viewTransactionStatus({txHash:hash,accountId:signer,waitUntil:'FINAL'})
    if(result.final_execution_status!=='FINAL'||result.transaction.hash!==hash||result.transaction.signer_id!==signer)throw new Error('Transaction is not finalized')
    for(const receipt of result.receipts_outcome){
      if(receipt.outcome.executor_id===this.contract && receipt.outcome.status && typeof receipt.outcome.status==='object' && ('SuccessValue' in receipt.outcome.status || 'SuccessReceiptId' in receipt.outcome.status))this.record(hash,receipt)
    }
  }
  private record(hash:string,receipt:Awaited<ReturnType<JsonRpcProvider['viewTransactionStatus']>>['receipts_outcome'][number]){
    this.db.transaction(()=>{
        for(const line of receipt.outcome.logs){
          if(!line.startsWith('EVENT_JSON:'))continue
          let event:MatchEvent
          try{event=JSON.parse(line.slice(11)) as MatchEvent}catch{continue}
          if(event.standard!=='promptplay_rps'||event.version!=='1.0.0'||!Array.isArray(event.data)||event.data.length!==1)continue
          const entry=event.data[0],sequence=Number(entry?.sequence),match=entry?.match
          if(!Number.isSafeInteger(sequence)||sequence<1||!match||!/^\d{1,20}$/.test(match.id)||!Array.isArray(match.players)||match.players.length!==2)continue
          const payload=JSON.stringify(match)
          const old=this.db.query('SELECT event,payload FROM rps_events WHERE match_id=? AND sequence=?').get(match.id,sequence) as {event:string;payload:string}|null
          if(old && (old.event!==event.event || old.payload!==payload))throw new Error('Conflicting match event')
          if(!old)this.db.query('INSERT INTO rps_events VALUES (?,?,?,?,?)').run(match.id,sequence,event.event,payload,hash)
        }
        this.db.query('INSERT OR IGNORE INTO rps_indexed_receipts VALUES (?)').run(receipt.id)
    }).immediate()
  }
  events(matchId:string){
    if(!/^\d{1,20}$/.test(matchId))return []
    return this.db.query('SELECT sequence,event,payload,tx_hash FROM rps_events WHERE match_id=? ORDER BY sequence LIMIT 1000').all(matchId)
  }
}
