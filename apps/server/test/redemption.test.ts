import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import type { JsonRpcProvider } from 'near-api-js'
import { Accounting } from '../src/accounting'
import { Redemption } from '../src/redemption'

test('finalized matching payment credits once and supports delayed verification', async () => {
  const db=new Database(':memory:'); const ledger=new Accounting(db,3_000_000); let intent: ReturnType<Redemption['create']>; let final=false
  const hash='1'.repeat(40)
  const rpc={getNetworkId:async()=>"testnet",viewTransactionStatus:async()=>{if(!final) throw new Error('Transaction not yet final');return {final_execution_status:'FINAL',status:{SuccessValue:''},transaction:{hash,signer_id:intent.account,receiver_id:intent.token,actions:[{FunctionCall:{method_name:'ft_transfer',deposit:'1',args:Buffer.from(JSON.stringify({receiver_id:intent.treasury,amount:intent.amount,memo:intent.memo})).toString('base64')}}]},transaction_outcome:{outcome:{status:{SuccessReceiptId:'receipt'}}},receipts_outcome:[{id:'receipt',block_hash:'block',outcome:{executor_id:intent.token,status:{SuccessValue:''},logs:[`EVENT_JSON:${JSON.stringify({standard:'nep141',version:'1.0.0',event:'ft_transfer',data:[{old_owner_id:intent.account,new_owner_id:intent.treasury,amount:intent.amount,memo:intent.memo}]})}`]}}]}},viewBlock:async(query:unknown)=>{expect(query).toEqual({blockId:'block'});return {header:{timestamp_nanosec:String(BigInt(intent.created+1)*1_000_000n)}}}} as unknown as JsonRpcProvider
  const redemption=new Redemption(db,ledger,rpc); intent=redemption.create('alice.testnet',2)
  redemption.beginTransfer(intent.id,'alice.testnet')
  await expect(redemption.verify(intent.id,'alice.testnet',hash)).rejects.toThrow('not yet final')
  expect(ledger.balance('alice.testnet')).toBe(0)
  expect(redemption.get(intent.id,'alice.testnet')?.attempted).toBe(1)
  expect(()=>redemption.beginTransfer(intent.id,'alice.testnet')).toThrow('already recorded')
  final=true
  db.exec("CREATE TRIGGER simulate_crash BEFORE UPDATE ON redemption_intents BEGIN SELECT RAISE(ABORT, 'simulated failure'); END")
  await expect(redemption.verify(intent.id,'alice.testnet',hash)).rejects.toThrow()
  expect(ledger.balance('alice.testnet')).toBe(0)
  db.exec('DROP TRIGGER simulate_crash')
  const results=await Promise.all([redemption.verify(intent.id,'alice.testnet',hash),redemption.verify(intent.id,'alice.testnet',hash)])
  expect(results.filter(r=>r.credited)).toHaveLength(1)
  expect(results.every(r=>r.receiptId==='receipt')).toBe(true)
  expect(await redemption.verify(intent.id,'alice.testnet',hash)).toEqual({credited:false,receiptId:'receipt'})
  expect(ledger.balance('alice.testnet')).toBe(2_000_000)
  await expect(redemption.verify(intent.id,'bob.testnet',hash)).rejects.toThrow('Unknown intent')
})

 test('reserves funding for pending intents',()=>{
  const db=new Database(':memory:'), ledger=new Accounting(db,1_000_000)
  const redemption=new Redemption(db,ledger,{} as JsonRpcProvider)
  expect(redemption.remainingUnits()).toBe(1)
  redemption.create('alice.testnet',1)
  expect(redemption.remainingUnits()).toBe(0)
  expect(()=>redemption.create('bob.testnet',1)).toThrow('fully allocated')
 })

 test('rejects a different network before examining payment',async()=>{
  const db=new Database(':memory:'),ledger=new Accounting(db,1_000_000)
  const redemption=new Redemption(db,ledger,{getNetworkId:async()=> 'mainnet'} as unknown as JsonRpcProvider)
  const intent=redemption.create('alice.testnet',1)
  redemption.beginTransfer(intent.id,'alice.testnet')
  await expect(redemption.verify(intent.id,'alice.testnet','1'.repeat(40))).rejects.toThrow('Unexpected NEAR network')
  expect(ledger.balance('alice.testnet')).toBe(0)
 })

test('only one payment attempt is recorded across server instances',()=>{
 const db=new Database(':memory:'),ledger=new Accounting(db,1_000_000),a=new Redemption(db,ledger,{} as JsonRpcProvider),b=new Redemption(db,ledger,{} as JsonRpcProvider)
 const intent=a.create('alice.testnet',1)
 expect(()=>a.beginTransfer(intent.id,'bob.testnet')).toThrow('unavailable')
 a.beginTransfer(intent.id,'alice.testnet')
 expect(()=>b.beginTransfer(intent.id,'alice.testnet')).toThrow('already recorded')
 expect(b.get(intent.id,'alice.testnet')?.attempted).toBe(1)
})

test('expired unattempted intents release capacity while attempted payments remain reserved',async()=>{
 const db=new Database(':memory:'),ledger=new Accounting(db,2000000),redemption=new Redemption(db,ledger,{} as JsonRpcProvider)
 const untouched=redemption.create('alice.testnet',1),attempted=redemption.create('bob.testnet',1)
 redemption.beginTransfer(attempted.id,'bob.testnet')
 db.query('UPDATE redemption_intents SET expires=? WHERE id IN (?,?)').run(Date.now()-1,untouched.id,attempted.id)
 expect(redemption.remainingUnits()).toBe(1)
 await expect(redemption.verify(untouched.id,'alice.testnet','1'.repeat(40))).rejects.toThrow('Payment attempt was not recorded')
 expect(redemption.create('carol.testnet',1).units).toBe(1)
 expect(redemption.remainingUnits()).toBe(0)
 db.close()
})
