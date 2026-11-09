import type { Database } from 'bun:sqlite'
import type { Accounting } from './accounting'
import { RequestError } from './errors'
import { randomBytes } from 'node:crypto'
import { inspectRejectedDeposit } from './escrow-receipt'

export type EscrowDeposit = {account:string;amount:string;units:string;expires:string;approved:boolean;status:'Pending'|'Consumed'|'Refunding'}
export type EscrowSettings = {token:string;owner:string;treasury:string;cap:string;allocated:string}
export type EscrowView = {deposit:EscrowDeposit|null;blockTimestampNs:string}
export interface EscrowChain {
  settings():Promise<EscrowSettings>
  deposit(account:string,id:string):Promise<EscrowView>
  approve(account:string,id:string,deposit:EscrowDeposit):Promise<void>
  rejected(account:string,id:string,hash:string,token:string):Promise<void>
}
const UNIT=1_000_000, PCC_PER_UNIT=5_000_000n
const validId=(id:string)=>/^[A-Za-z0-9_-]{32,64}$/.test(id)
const amount=(value:string)=>{if(!/^(0|[1-9][0-9]*)$/.test(value))throw new Error('Invalid escrow amount');return BigInt(value)}

/** Only finalized contract state may create, settle, or release an escrow reservation. */
export class EscrowRedemption {
  constructor(private db:Database,private ledger:Accounting,private chain:EscrowChain,private contract:string,private token:string,private owner:string,private treasury:string){
    db.exec(`CREATE TABLE IF NOT EXISTS escrow_config (id INTEGER PRIMARY KEY CHECK(id=1), contract TEXT NOT NULL, token TEXT NOT NULL, owner TEXT NOT NULL, baseline INTEGER NOT NULL, cap_units INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS escrow_reservations (account_id TEXT NOT NULL, deposit_id TEXT NOT NULL, units INTEGER NOT NULL, expires_ns TEXT NOT NULL, expires_ms INTEGER NOT NULL, checked_ms INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL CHECK(state IN ('held','credited','refunded')), PRIMARY KEY(account_id,deposit_id));
      CREATE TABLE IF NOT EXISTS escrow_intents (account_id TEXT NOT NULL, deposit_id TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(account_id,deposit_id));
      CREATE TABLE IF NOT EXISTS escrow_rejections (account_id TEXT NOT NULL, deposit_id TEXT NOT NULL, tx_hash TEXT NOT NULL UNIQUE, PRIMARY KEY(account_id,deposit_id));
      CREATE INDEX IF NOT EXISTS escrow_held_expiry ON escrow_reservations(state,expires_ms);
      CREATE INDEX IF NOT EXISTS escrow_intents_created ON escrow_intents(account_id,created);`)
  }
  get escrowAccount(){return this.contract}
  async initialize(){
    const settings=await this.chain.settings(),cap=amount(settings.cap),allocated=amount(settings.allocated)
    if(settings.token!==this.token||settings.owner!==this.owner||settings.treasury!==this.treasury||cap<=0n||allocated>cap||cap>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Escrow configuration mismatch')
    this.db.transaction(()=>{
      const economyExists=this.db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='economy_settings'").get()
      if(economyExists){
        const row=this.db.query('SELECT settings FROM economy_settings WHERE id=1').get() as {settings:string}|null
        if(row && (JSON.parse(row.settings) as {cap?:unknown}).cap!==this.ledger.issuanceLimit())throw new Error('Economy cap mismatch')
      }
      const current=this.db.query('SELECT contract,token,owner,baseline,cap_units FROM escrow_config WHERE id=1').get() as {contract:string;token:string;owner:string;baseline:number;cap_units:number}|null
      if(current){
        if(current.contract!==this.contract||current.token!==this.token||current.owner!==this.owner||BigInt(current.cap_units)!==cap||current.baseline+current.cap_units*UNIT>this.ledger.issuanceLimit())throw new Error('Escrow configuration mismatch')
        return
      }
      if(allocated!==0n)throw new Error('Escrow must be empty at initialization')
      const exists=this.db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='redemption_intents'").get()
      if(exists){
        const pending=this.db.query("SELECT COUNT(*) AS count FROM redemption_intents WHERE receipt_id IS NULL AND EXISTS(SELECT 1 FROM redemption_attempts WHERE intent_id=redemption_intents.id) AND NOT EXISTS(SELECT 1 FROM redemption_failures WHERE intent_id=redemption_intents.id)").get() as {count:number}
        if(pending.count)throw new Error('Reconcile previous payment attempts before switching')
      }
      const {issued}=this.db.query('SELECT COALESCE(SUM(amount),0) AS issued FROM receipts').get() as {issued:number}
      if(!Number.isSafeInteger(issued)||BigInt(issued)+cap*BigInt(UNIT)>BigInt(this.ledger.issuanceLimit()))throw new Error('Escrow cap exceeds available issuance')
      this.db.query('INSERT INTO escrow_config VALUES (1,?,?,?,?,?)').run(this.contract,this.token,this.owner,issued,Number(cap))
    }).immediate()
  }
  private validate(account:string,id:string,d:EscrowDeposit){
    if(!account.endsWith('.testnet')||!validId(id)||d.account!==account||!['Pending','Consumed','Refunding'].includes(d.status))throw new RequestError('Invalid escrow deposit',400)
    const units=amount(d.units),pcc=amount(d.amount),expires=amount(d.expires)
    if(units<1n||units>BigInt(Math.floor(Number.MAX_SAFE_INTEGER/UNIT))||pcc!==units*PCC_PER_UNIT||expires<1n||typeof d.approved!=='boolean')throw new RequestError('Invalid escrow deposit',400)
    return Number(units)
  }
  create(account:string){
    if(!account.endsWith('.testnet'))throw new RequestError('Invalid account',400)
    const id=randomBytes(24).toString('base64url')
    this.db.query('INSERT INTO escrow_intents VALUES (?,?,?)').run(account,id,Date.now())
    return {id,account,token:this.token,escrow:this.contract,amount:PCC_PER_UNIT.toString()}
  }
  list(account:string){return this.db.query('SELECT deposit_id AS id,created,EXISTS(SELECT 1 FROM escrow_rejections WHERE account_id=escrow_intents.account_id AND deposit_id=escrow_intents.deposit_id) AS rejected FROM escrow_intents WHERE account_id=? ORDER BY created DESC LIMIT 50').all(account)}
  async status(account:string,id:string){
    if(!validId(id)||!account.endsWith('.testnet'))throw new RequestError('Invalid escrow deposit',400)
    const {deposit}=await this.chain.deposit(account,id)
    if(deposit)this.validate(account,id,deposit)
    const reservation=this.db.query('SELECT state FROM escrow_reservations WHERE account_id=? AND deposit_id=?').get(account,id) as {state:string}|null
    const rejected=!!this.db.query('SELECT 1 FROM escrow_rejections WHERE account_id=? AND deposit_id=?').get(account,id)
    return {deposit,reservation:reservation?.state??null,rejected}
  }
  async remainingUnits(){
    await this.sweepExpired()
    const settings=await this.chain.settings(),cap=amount(settings.cap),allocated=amount(settings.allocated)
    if(settings.token!==this.token||settings.owner!==this.owner||settings.treasury!==this.treasury||allocated>cap)throw new Error('Escrow configuration mismatch')
    const {issued}=this.db.query('SELECT COALESCE(SUM(amount),0) AS issued FROM receipts').get() as {issued:number}
    const {held}=this.db.query("SELECT COALESCE(SUM(units),0) AS held FROM escrow_reservations WHERE state='held'").get() as {held:number}
    return Math.max(0,Math.min(Number(cap-allocated),Math.floor((this.ledger.issuanceLimit()-issued)/UNIT)-held))
  }
  async authorize(account:string,id:string){
    if(!validId(id)||!account.endsWith('.testnet'))throw new RequestError('Invalid escrow deposit',400)
    await this.sweepExpired()
    const {deposit}=await this.chain.deposit(account,id)
    if(!deposit||deposit.status!=='Pending')throw new RequestError('Escrow deposit is unavailable',409)
    const units=this.validate(account,id,deposit)
    this.db.transaction(()=>{
      if(!this.db.query('SELECT 1 FROM escrow_config WHERE id=1').get())throw new Error('Escrow is not initialized')
      if(this.db.query('SELECT 1 FROM escrow_rejections WHERE account_id=? AND deposit_id=?').get(account,id))throw new RequestError('Escrow intent is closed',409)
      const old=this.db.query('SELECT units,expires_ns,state FROM escrow_reservations WHERE account_id=? AND deposit_id=?').get(account,id) as {units:number;expires_ns:string;state:string}|null
      if(old){if(old.units!==units||old.expires_ns!==deposit.expires||old.state!=='held')throw new RequestError('Escrow reservation is unavailable',409);return}
      const {issued}=this.db.query('SELECT COALESCE(SUM(amount),0) AS issued FROM receipts').get() as {issued:number}
      const {held}=this.db.query("SELECT COALESCE(SUM(units),0) AS held FROM escrow_reservations WHERE state='held'").get() as {held:number}
      if(!Number.isSafeInteger(issued+(held+units)*UNIT)||issued+(held+units)*UNIT>this.ledger.issuanceLimit())throw new RequestError('Gateway allocation exhausted',409)
      const expiryMs=amount(deposit.expires)/1_000_000n
      if(expiryMs>BigInt(Number.MAX_SAFE_INTEGER))throw new RequestError('Invalid escrow expiry',400)
      this.db.query("INSERT INTO escrow_reservations (account_id,deposit_id,units,expires_ns,expires_ms,state) VALUES (?,?,?,?,?,'held')").run(account,id,units,deposit.expires,Number(expiryMs))
    }).immediate()
    if(!deposit.approved)await this.chain.approve(account,id,deposit)
    return {approved:true}
  }
  async claim(account:string,id:string){
    if(!validId(id)||!account.endsWith('.testnet'))throw new RequestError('Invalid escrow deposit',400)
    const {deposit}=await this.chain.deposit(account,id)
    if(!deposit||deposit.status!=='Consumed'||!deposit.approved)throw new RequestError('Escrow deposit is not consumed',409)
    const units=this.validate(account,id,deposit)
    return this.db.transaction(()=>{
      const held=this.db.query('SELECT units,expires_ns,state FROM escrow_reservations WHERE account_id=? AND deposit_id=?').get(account,id) as {units:number;expires_ns:string;state:string}|null
      if(!held||held.units!==units||held.expires_ns!==deposit.expires||held.state==='refunded')throw new RequestError('Escrow reservation is unavailable',409)
      if(held.state==='credited')return {credited:false}
      const receipt=`${this.contract}:${account}:${id}`
      const credited=this.ledger.creditReceipt(receipt,receipt,account,units*UNIT)
      this.db.query("UPDATE escrow_reservations SET state='credited' WHERE account_id=? AND deposit_id=? AND state='held'").run(account,id)
      return {credited}
    }).immediate()
  }
  async reconcileRefund(account:string,id:string){
    if(!validId(id)||!account.endsWith('.testnet'))throw new RequestError('Invalid escrow deposit',400)
    const previous=this.db.query('SELECT state,expires_ns FROM escrow_reservations WHERE account_id=? AND deposit_id=?').get(account,id) as {state:string;expires_ns:string}|null
    if(!previous||previous.state==='credited')throw new RequestError('Escrow reservation is unavailable',409)
    const view=await this.chain.deposit(account,id)
    if(view.deposit||amount(view.blockTimestampNs)<amount(previous.expires_ns))throw new RequestError('Escrow refund is not finalized',409)
    return this.db.transaction(()=>{
      const held=this.db.query('SELECT state FROM escrow_reservations WHERE account_id=? AND deposit_id=?').get(account,id) as {state:string}|null
      if(!held||held.state==='credited')throw new RequestError('Escrow reservation is unavailable',409)
      if(held.state==='held')this.db.query("UPDATE escrow_reservations SET state='refunded' WHERE account_id=? AND deposit_id=?").run(account,id)
      return {refunded:true}
    }).immediate()
  }
  async reconcileRejection(account:string,id:string,hash:string){
    if(!validId(id)||!account.endsWith('.testnet')||!/^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(hash))throw new RequestError('Invalid escrow transaction',400)
    await this.chain.rejected(account,id,hash,this.token)
    if((await this.chain.deposit(account,id)).deposit)throw new RequestError('An escrow deposit exists',409)
    return this.db.transaction(()=>{
      if(this.db.query('SELECT 1 FROM escrow_reservations WHERE account_id=? AND deposit_id=?').get(account,id))throw new RequestError('Escrow reservation exists',409)
      const old=this.db.query('SELECT tx_hash FROM escrow_rejections WHERE account_id=? AND deposit_id=?').get(account,id) as {tx_hash:string}|null
      if(old && old.tx_hash!==hash)throw new RequestError('Escrow intent is closed',409)
      if(!old)this.db.query('INSERT INTO escrow_rejections VALUES (?,?,?)').run(account,id,hash)
      return {rejected:true}
    }).immediate()
  }
  async sweepExpired(now=Date.now()){
    const rows=this.db.query("SELECT account_id,deposit_id,expires_ns FROM escrow_reservations WHERE state='held' AND expires_ms<=? AND (checked_ms=0 OR checked_ms<=?) ORDER BY checked_ms,expires_ms LIMIT 20").all(now,now-30000) as Array<{account_id:string;deposit_id:string;expires_ns:string}>
    for(const row of rows){
      const view=await this.chain.deposit(row.account_id,row.deposit_id)
      if(view.deposit===null && amount(view.blockTimestampNs)>=amount(row.expires_ns))this.db.query("UPDATE escrow_reservations SET state='refunded' WHERE account_id=? AND deposit_id=? AND state='held'").run(row.account_id,row.deposit_id)
      else this.db.query("UPDATE escrow_reservations SET checked_ms=? WHERE account_id=? AND deposit_id=? AND state='held'").run(now,row.account_id,row.deposit_id)
    }
  }
}

export function nearEscrowChain(rpc:import('near-api-js').JsonRpcProvider,signer:import('near-api-js').Account,contract:string,codeHash:string):EscrowChain {
  if(!/^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(codeHash))throw new Error('Invalid escrow code hash')
  async function view(method:string,args:Record<string,unknown>) {
    if(await rpc.getNetworkId()!=='testnet')throw new Error('Unexpected NEAR network')
    const code=await rpc.viewAccount({accountId:contract,blockQuery:{finality:'final'}})
    if(code.code_hash!==codeHash || !code.block_hash)throw new Error('Escrow code does not match')
    return {value:await rpc.callFunction({contractId:contract,method,args,blockQuery:{blockId:code.block_hash}}),blockHash:code.block_hash}
  }
  return {
    async settings(){const {value}=await view('settings',{});if(!value)throw new Error('Escrow settings unavailable');const settings=value as EscrowSettings;if(settings.owner!==signer.accountId)throw new Error('Escrow owner mismatch');const key=signer.getSigner();if(!key)throw new Error('Escrow signer unavailable');const access=await rpc.viewAccessKey({accountId:signer.accountId,publicKey:await key.getPublicKey(),finalityQuery:{finality:'final'}});if(typeof access.permission!=='object'||!('FunctionCall' in access.permission)||access.permission.FunctionCall.receiver_id!==contract||access.permission.FunctionCall.method_names.length!==1||access.permission.FunctionCall.method_names[0]!=='approve')throw new Error('Escrow signer must be restricted to approval');return settings},
    async deposit(account,id){const {value,blockHash}=await view('get_deposit',{account,id});if(value===undefined)throw new Error('Escrow response unavailable');const block=await rpc.viewBlock({blockId:blockHash});if(block.header.hash!==blockHash || !block.header.timestamp_nanosec)throw new Error('Escrow block unavailable');return {deposit:value as EscrowDeposit|null,blockTimestampNs:block.header.timestamp_nanosec}},
    async approve(account,id,deposit){await view('settings',{});const result=await signer.callFunctionRaw({contractId:contract,methodName:'approve',args:{account,id,amount:deposit.amount,expires:deposit.expires},gas:30000000000000n,deposit:0n,waitUntil:'FINAL'});if(result.final_execution_status!=='FINAL'||!result.status||typeof result.status!=='object'||!('SuccessValue' in result.status))throw new Error('Escrow approval was not confirmed')},
    async rejected(account,id,hash,token){if(await rpc.getNetworkId()!=='testnet')throw new Error('Unexpected NEAR network');const result=await rpc.viewTransactionStatus({txHash:hash,accountId:account,waitUntil:'FINAL'});inspectRejectedDeposit(result,{hash,account,token,escrow:contract,id,amount:PCC_PER_UNIT.toString()})},
  }
}
