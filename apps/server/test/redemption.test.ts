import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import type { JsonRpcProvider } from 'near-api-js'
import { Accounting } from '../src/accounting'
import { Redemption } from '../src/redemption'

test('finalized matching payment credits once and supports delayed verification', async () => {
  const db=new Database(':memory:'); const ledger=new Accounting(db,100); let intent:any
  const hash='1'.repeat(40)
  const rpc={getNetworkId:async()=>"testnet",viewTransactionStatus:async()=>({final_execution_status:'FINAL',status:{SuccessValue:''},transaction:{hash,signer_id:intent.account,receiver_id:intent.token,actions:[{FunctionCall:{method_name:'ft_transfer',deposit:'1',args:Buffer.from(JSON.stringify({receiver_id:intent.treasury,amount:intent.amount,memo:intent.memo})).toString('base64')}}]},transaction_outcome:{outcome:{status:{SuccessReceiptId:'receipt'}}},receipts_outcome:[{id:'receipt',block_hash:'block',outcome:{executor_id:intent.token,status:{SuccessValue:''},logs:[`EVENT_JSON:${JSON.stringify({standard:'nep141',version:'1.0.0',event:'ft_transfer',data:[{old_owner_id:intent.account,new_owner_id:intent.treasury,amount:intent.amount,memo:intent.memo}]})}`]}}]}),viewBlock:async(query:any)=>{expect(query).toEqual({blockId:'block'});return {header:{timestamp_nanosec:String(BigInt(intent.created+1)*1_000_000n)}}}} as unknown as JsonRpcProvider
  const redemption=new Redemption(db,ledger,rpc); intent=redemption.create('alice.testnet',2)
  const results=await Promise.all([redemption.verify(intent.id,'alice.testnet',hash),redemption.verify(intent.id,'alice.testnet',hash)])
  expect(results.filter(r=>r.credited)).toHaveLength(1)
  expect(results.every(r=>r.receiptId==='receipt')).toBe(true)
  expect(await redemption.verify(intent.id,'alice.testnet',hash)).toEqual({credited:false,receiptId:'receipt'})
  expect(ledger.balance('alice.testnet')).toBe(2_000_000)
  await expect(redemption.verify(intent.id,'bob.testnet',hash)).rejects.toThrow('Unknown intent')
})
