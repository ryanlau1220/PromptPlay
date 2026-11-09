import { Database } from 'bun:sqlite'
import { Accounting } from './accounting'
import { GatewayKeys } from './keys'
import { Gateway } from './gateway'
import { mockProvider } from './provider'
import { EscrowRedemption, type EscrowChain, type EscrowDeposit } from './escrow-redemption'

console.log('MOCK DEMO — simulated escrow and response; no on-chain transfer or real inference')
const db=new Database(':memory:'),ledger=new Accounting(db,1_000_000),keys=new GatewayKeys(db)
const account='demo.testnet';let deposit:EscrowDeposit|null=null
const chain:EscrowChain={async settings(){return {token:'token.testnet',owner:'owner.testnet',treasury:'treasury.testnet',cap:'1',allocated:deposit?'1':'0'}},async deposit(){return {deposit,blockTimestampNs:'99999999999999999999'}},async approve(){if(!deposit)throw new Error('Missing deposit');deposit.approved=true},async rejected(){throw new Error('No transaction')}}
const redemption=new EscrowRedemption(db,ledger,chain,'escrow.testnet','token.testnet','owner.testnet','treasury.testnet')
await redemption.initialize();const intent=redemption.create(account)
deposit={account,amount:'5000000',units:'1',expires:'9999999999999999999',approved:false,status:'Pending'}
await redemption.authorize(account,intent.id);deposit.status='Consumed'
const first=await redemption.claim(account,intent.id),replay=await redemption.claim(account,intent.id)
if(!first.credited||replay.credited)throw new Error('Mock redemption replay check failed')
const key=keys.create(account,1_000_000),gateway=new Gateway(ledger,keys,mockProvider(),'mock-model',{inputMicrosPerMillion:1_000_000,outputMicrosPerMillion:2_000_000,microsPerUnit:1_000_000,contextTokens:100,maxOutputTokens:10})
console.log('Simulated escrow credited:',first.credited,'Replay credited:',replay.credited)
console.log('Allowance before:',ledger.balance(account),'microunits')
const result=await gateway.complete(key.key,'mock-model',[{role:'user',content:'Hello'}],10)
console.log('Mock response:',result.choices[0]?.message.content)
console.log('Usage:',JSON.stringify(result.usage),'Allowance after:',ledger.balance(account),'microunits')
db.close()
