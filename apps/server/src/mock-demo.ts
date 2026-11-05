import { Database } from 'bun:sqlite'
import { Accounting } from './accounting'
import { GatewayKeys } from './keys'
import { Gateway } from './gateway'
import { mockProvider } from './provider'

// Offline demonstration only. This never contacts NEAR or an inference provider.
const db=new Database(':memory:'); const ledger=new Accounting(db,1_000_000); const keys=new GatewayKeys(db)
ledger.creditReceipt('mock-receipt','mock-intent','demo.testnet',1_000_000)
const key=keys.create('demo.testnet',1_000_000)
const gateway=new Gateway(ledger,keys,mockProvider(),'mock-model',{inputMicrosPerMillion:1_000_000,outputMicrosPerMillion:2_000_000,microsPerUnit:1_000_000,contextTokens:100,maxOutputTokens:10})
console.log('MOCK DEMO — no on-chain transfer or real inference')
console.log('Allowance before:',ledger.balance('demo.testnet'),'microunits')
const result=await gateway.complete(key.key,'mock-model',[{role:'user',content:'Hello'}],10)
console.log('Mock response:',result.choices[0]?.message.content)
console.log('Usage:',JSON.stringify(result.usage),'Allowance after:',ledger.balance('demo.testnet'),'microunits')
db.close()
