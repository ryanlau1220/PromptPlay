import { Database } from 'bun:sqlite'
import type { JsonRpcProvider } from 'near-api-js'
import { Accounting } from './accounting'
import { GatewayKeys } from './keys'
import { Gateway } from './gateway'
import { mockProvider } from './provider'
import { Redemption } from './redemption'

// Offline demonstration only. The receipt and model response are simulated.
console.log('MOCK DEMO — simulated receipt and response; no on-chain transfer or real inference')
const db=new Database(':memory:'); const ledger=new Accounting(db,1_000_000); const keys=new GatewayKeys(db)
const hash='1'.repeat(40)
let intent:ReturnType<Redemption['create']>
const rpc={
  getNetworkId:async()=> 'testnet',
  viewTransactionStatus:async()=>({
    final_execution_status:'FINAL',status:{SuccessValue:''},
    transaction:{hash,signer_id:intent.account,receiver_id:intent.token,actions:[{FunctionCall:{method_name:'ft_transfer',deposit:'1',args:Buffer.from(JSON.stringify({receiver_id:intent.treasury,amount:intent.amount,memo:intent.memo})).toString('base64')}}]},
    transaction_outcome:{outcome:{status:{SuccessReceiptId:'mock-receipt'}}},
    receipts_outcome:[{id:'mock-receipt',block_hash:'mock-block',outcome:{executor_id:intent.token,status:{SuccessValue:''},logs:[`EVENT_JSON:${JSON.stringify({standard:'nep141',version:'1.0.0',event:'ft_transfer',data:[{old_owner_id:intent.account,new_owner_id:intent.treasury,amount:intent.amount,memo:intent.memo}]})}`]}}]
  }),
  viewBlock:async()=>({header:{timestamp_nanosec:String(BigInt(intent.created+1)*1_000_000n)}})
} as unknown as JsonRpcProvider
const redemption=new Redemption(db,ledger,rpc)
intent=redemption.create('demo.testnet',1)
redemption.beginTransfer(intent.id,intent.account)
const first=await redemption.verify(intent.id,intent.account,hash)
const replay=await redemption.verify(intent.id,intent.account,hash)
if(!first.credited || replay.credited) throw new Error('Mock redemption replay check failed')
const key=keys.create(intent.account,1_000_000)
const gateway=new Gateway(ledger,keys,mockProvider(),'mock-model',{inputMicrosPerMillion:1_000_000,outputMicrosPerMillion:2_000_000,microsPerUnit:1_000_000,contextTokens:100,maxOutputTokens:10})
console.log('Simulated receipt verified:',first.credited,'Replay credited:',replay.credited)
console.log('Allowance before:',ledger.balance(intent.account),'microunits')
const result=await gateway.complete(key.key,'mock-model',[{role:'user',content:'Hello'}],10)
console.log('Mock response:',result.choices[0]?.message.content)
console.log('Usage:',JSON.stringify(result.usage),'Allowance after:',ledger.balance(intent.account),'microunits')
db.close()
