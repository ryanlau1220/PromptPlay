import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { Accounting } from '../src/accounting'
import { EscrowRedemption, nearEscrowChain, type EscrowChain, type EscrowDeposit } from '../src/escrow-redemption'
import type { Account, JsonRpcProvider } from 'near-api-js'
const id='a'.repeat(32),account='alice.testnet'
function fixture(cap=3_000_000){
 const db=new Database(':memory:'),ledger=new Accounting(db,cap)
 let deposit:EscrowDeposit|null=null,fail=false,chainCap='3',blockTime='99999999999999999999'
 const chain:EscrowChain={async settings(){return {token:'token.testnet',owner:'owner.testnet',treasury:'treasury.testnet',cap:chainCap,allocated:'0'}},async deposit(){return {deposit,blockTimestampNs:blockTime}},async rejected(){},async approve(){if(!deposit)throw new Error('missing');deposit.approved=true;if(fail)throw new Error('uncertain transaction')}}
 const service=new EscrowRedemption(db,ledger,chain,'escrow.testnet','token.testnet','owner.testnet','treasury.testnet')
 return {db,ledger,service,setDeposit(value:EscrowDeposit|null){deposit=value},setFail(value:boolean){fail=value},setCap(value:string){chainCap=value},setBlockTime(value:string){blockTime=value}}
}
const pending=():EscrowDeposit=>({account,amount:'5000000',units:'1',expires:'9999999999999999999',approved:false,status:'Pending'})
test('reserves only after a paid deposit and credits consumed escrow exactly once',async()=>{
 const f=fixture();await f.service.initialize()
 const intent=f.service.create(account);expect(intent.id).toMatch(/^[A-Za-z0-9_-]{32}$/);expect(f.service.list(account)).toHaveLength(1)
 expect(await f.service.remainingUnits()).toBe(3)
 await expect(f.service.authorize(account,id)).rejects.toThrow('unavailable')
 f.setDeposit(pending());await f.service.authorize(account,id)
 expect(await f.service.status(account,id)).toMatchObject({reservation:'held',deposit:{status:'Pending',approved:true}})
 expect(await f.service.remainingUnits()).toBe(2)
 expect(f.ledger.balance(account)).toBe(0)
 await expect(f.service.claim(account,id)).rejects.toThrow('not consumed')
 f.setDeposit({...pending(),approved:true,status:'Consumed'})
 expect(await f.service.claim(account,id)).toEqual({credited:true});expect(await f.service.claim(account,id)).toEqual({credited:false})
 expect(f.ledger.balance(account)).toBe(1000000);f.db.close()
})
test('uncertain authorization remains reserved and can resume or reconcile a finalized refund',async()=>{
 const f=fixture();await f.service.initialize();f.setDeposit(pending());f.setFail(true)
 await expect(f.service.authorize(account,id)).rejects.toThrow('uncertain')
 expect(f.db.query("SELECT state FROM escrow_reservations").get()).toEqual({state:'held'})
 f.setFail(false);expect(await f.service.authorize(account,id)).toEqual({approved:true})
 await expect(f.service.reconcileRefund(account,id)).rejects.toThrow('not finalized')
 f.setDeposit(null);f.setBlockTime('1');await expect(f.service.reconcileRefund(account,id)).rejects.toThrow('not finalized');f.setBlockTime('99999999999999999999');expect(await f.service.reconcileRefund(account,id)).toEqual({refunded:true})
 expect(await f.service.reconcileRefund(account,id)).toEqual({refunded:true})
 expect(f.db.query("SELECT state FROM escrow_reservations").get()).toEqual({state:'refunded'});f.db.close()
})
test('expired reservations are automatically released only after finalized refund',async()=>{
 const f=fixture();await f.service.initialize();f.setDeposit({...pending(),expires:'1000000'});await f.service.authorize(account,id)
 await f.service.sweepExpired(2);expect(f.db.query('SELECT state FROM escrow_reservations').get()).toEqual({state:'held'})
 f.setDeposit(null);await f.service.sweepExpired(30002);expect(f.db.query('SELECT state FROM escrow_reservations').get()).toEqual({state:'refunded'})
 expect(f.ledger.balance(account)).toBe(0);f.db.close()
})
test('a reused deposit id cannot inherit an older authorization',async()=>{
 const f=fixture();await f.service.initialize();f.setDeposit(pending());await f.service.authorize(account,id)
 f.setDeposit({...pending(),expires:'9999999999999999998'})
 await expect(f.service.authorize(account,id)).rejects.toThrow('reservation is unavailable')
 f.setDeposit({...pending(),expires:'9999999999999999998',approved:true,status:'Consumed'})
 await expect(f.service.claim(account,id)).rejects.toThrow('reservation is unavailable')
 expect(f.ledger.balance(account)).toBe(0);f.db.close()
})
test('rejects altered deposit details and cannot credit unreserved consumption',async()=>{
 const f=fixture();await f.service.initialize();f.setDeposit({...pending(),account:'bob.testnet'})
 await expect(f.service.authorize(account,id)).rejects.toThrow('Invalid escrow deposit')
 f.setDeposit({...pending(),approved:true,status:'Consumed'})
 await expect(f.service.claim(account,id)).rejects.toThrow('reservation is unavailable')
 expect(f.ledger.balance(account)).toBe(0);f.db.close()
})
test('initial cap accounts for previous issuance and blocks pending legacy payments',async()=>{
 const f=fixture();f.ledger.creditReceipt('old','old-intent','bob.testnet',1000000)
 await expect(f.service.initialize()).rejects.toThrow('cap exceeds')
 f.setCap('2');await f.service.initialize();await f.service.initialize()
 f.setCap('3');await expect(f.service.initialize()).rejects.toThrow('configuration mismatch');f.db.close()
 const g=fixture();g.db.exec("CREATE TABLE redemption_intents(id TEXT,receipt_id TEXT);CREATE TABLE redemption_attempts(intent_id TEXT);CREATE TABLE redemption_failures(intent_id TEXT);INSERT INTO redemption_intents VALUES ('x',NULL);INSERT INTO redemption_attempts VALUES ('x')")
 await expect(g.service.initialize()).rejects.toThrow('Reconcile previous');g.db.close()
})
test('chain adapter pins code and uses the same finalized block for views',async()=>{
 const hash='1'.repeat(44),calls:unknown[]=[]
 const rpc={getNetworkId:async()=> 'testnet',viewAccount:async()=>({code_hash:hash,block_hash:'block'}),callFunction:async(input:unknown)=>{calls.push(input);return {token:'token.testnet',owner:'owner.testnet',treasury:'treasury.testnet',cap:'3',allocated:'0'}},viewAccessKey:async()=>({permission:{FunctionCall:{receiver_id:'escrow.testnet',method_names:['approve']}}})} as unknown as JsonRpcProvider
 const signer={accountId:'owner.testnet',getSigner:()=>({getPublicKey:async()=> 'public-key'})} as unknown as Account
 const chain=nearEscrowChain(rpc,signer,'escrow.testnet',hash)
 expect((await chain.settings()).owner).toBe('owner.testnet')
 expect(calls[0]).toMatchObject({method:'settings',blockQuery:{blockId:'block'}})
 const mismatch={...rpc,viewAccount:async()=>({code_hash:'different',block_hash:'block'})} as unknown as JsonRpcProvider
 await expect(nearEscrowChain(mismatch,signer,'escrow.testnet',hash).settings()).rejects.toThrow('code does not match')
 const full={...rpc,viewAccessKey:async()=>({permission:'FullAccess'})} as unknown as JsonRpcProvider
 await expect(nearEscrowChain(full,signer,'escrow.testnet',hash).settings()).rejects.toThrow('restricted')
})
