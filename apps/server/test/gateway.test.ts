import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { Accounting } from '../src/accounting'
import { GatewayKeys } from '../src/keys'
import { Gateway } from '../src/gateway'
import { mockProvider } from '../src/provider'
const pricing={inputMicrosPerMillion:1_000_000,outputMicrosPerMillion:2_000_000,microsPerUnit:1_000_000,contextTokens:100,maxOutputTokens:10}
test('meters a mock response and enforces key quota',async()=>{
 const db=new Database(':memory:');const ledger=new Accounting(db,1000);const keys=new GatewayKeys(db)
 ledger.creditReceipt('receipt','intent','alice',1000);const key=keys.create('alice',120);const g=new Gateway(ledger,keys,mockProvider(),'model',pricing)
 const answer=await g.complete(key.key,'model',[{role:'user',content:'hello'}],10)
 expect(answer.choices[0]?.message.content).toBe('Mock response');expect(ledger.balance('alice')).toBe(994)
 expect(ledger.usage('alice')[0]).toMatchObject({charged:6,input_tokens:2,output_tokens:2,state:'settled'})
 await expect(g.complete(key.key,'model',[{role:'user',content:'hello'}],10)).rejects.toThrow('quota')
 await expect(g.complete(key.key,'other',[{role:'user',content:'hello'}],10)).rejects.toThrow('Model')
 keys.revoke('alice',key.id);await expect(g.complete(key.key,'model',[{role:'user',content:'hello'}],10)).rejects.toThrow('API key')
})
test('uncertain provider failure keeps the reservation',async()=>{
 const db=new Database(':memory:');const ledger=new Accounting(db,1000);const keys=new GatewayKeys(db)
 ledger.creditReceipt('r','i','alice',1000);const key=keys.create('alice',1000)
 const g=new Gateway(ledger,keys,{complete:async()=>{throw new Error('timeout')}},'model',pricing)
 await expect(g.complete(key.key,'model',[{role:'user',content:'hello'}],10)).rejects.toThrow()
 expect(ledger.balance('alice')).toBe(880);expect(ledger.usage('alice')[0]).toMatchObject({reserved:120,state:'reserved'})
})
test('simultaneous requests cannot spend the same key quota',async()=>{
 const db=new Database(':memory:'),ledger=new Accounting(db,1000),keys=new GatewayKeys(db)
 ledger.creditReceipt('r','i','alice',1000);const key=keys.create('alice',120)
 let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve})
 const g=new Gateway(ledger,keys,{complete:async()=>{await waiting;return {text:'Mock response',inputTokens:2,outputTokens:2,finishReason:'stop'}}},'model',pricing)
 const first=g.complete(key.key,'model',[{role:'user',content:'a'}],10)
 await expect(g.complete(key.key,'model',[{role:'user',content:'b'}],10)).rejects.toThrow('quota')
 release();await first;expect(ledger.balance('alice')).toBe(994)
})

test('rejects a demo rate that cannot cover the reserved request',()=>{
 const db=new Database(':memory:'),ledger=new Accounting(db,1000000),keys=new GatewayKeys(db)
 expect(()=>new Gateway(ledger,keys,mockProvider(),'model',{...pricing,microsPerUnit:1})).toThrow('cannot cover')
})

test('rate limit applies across all keys owned by one account',async()=>{
 const db=new Database(':memory:'),ledger=new Accounting(db,1000000),keys=new GatewayKeys(db)
 ledger.creditReceipt('r','i','alice',100000);ledger.creditReceipt('r2','i2','bob',100000)
 const first=keys.create('alice',100000),second=keys.create('alice',100000),other=keys.create('bob',100000)
 const gateway=new Gateway(ledger,keys,mockProvider(),'model',pricing)
 for(let i=0;i<10;i++) await gateway.complete(first.key,'model',[{role:'user',content:'hello'}],10)
 await expect(gateway.complete(second.key,'model',[{role:'user',content:'hello'}],10)).rejects.toThrow('Rate limit exceeded')
 expect((await gateway.complete(other.key,'model',[{role:'user',content:'hello'}],10)).choices[0]?.message.content).toBe('Mock response')
})
