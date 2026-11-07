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
 await expect(g.complete(key.key,'model',[{role:'user',content:'again'}],10)).rejects.toThrow('timeout')
 await expect(g.complete(key.key,'model',[{role:'user',content:'again'}],10)).rejects.toThrow('timeout')
 expect(ledger.usage('alice').filter((request:any)=>request.state==='reserved')).toHaveLength(3)
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

test('limits concurrent requests across keys for one account and releases slots',async()=>{
 const db=new Database(':memory:'),ledger=new Accounting(db,10000),keys=new GatewayKeys(db)
 ledger.creditReceipt('r','i','alice',10000);const a=keys.create('alice',10000),b=keys.create('alice',10000)
 let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve})
 const gateway=new Gateway(ledger,keys,{complete:async()=>{await waiting;return {text:'ok',inputTokens:2,outputTokens:2,finishReason:'stop'}}},'model',pricing)
 const first=gateway.complete(a.key,'model',[{role:'user',content:'a'}],10),second=gateway.complete(b.key,'model',[{role:'user',content:'b'}],10)
 await expect(gateway.complete(a.key,'model',[{role:'user',content:'c'}],10)).rejects.toThrow('Concurrency limit')
 expect(ledger.usage('alice')).toHaveLength(2)
 release();await Promise.all([first,second])
 await expect(gateway.complete(a.key,'model',[{role:'user',content:'d'}],10)).resolves.toBeDefined()
})

test('limits total concurrency across accounts',async()=>{
 const db=new Database(':memory:'),ledger=new Accounting(db,100000),keys=new GatewayKeys(db)
 let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve})
 const gateway=new Gateway(ledger,keys,{complete:async()=>{await waiting;return {text:'ok',inputTokens:2,outputTokens:2,finishReason:'stop'}}},'model',pricing)
 const created=Array.from({length:9},(_,i)=>{const id=`player-${i}`;ledger.creditReceipt(`r${i}`,`i${i}`,id,10000);return keys.create(id,10000)})
 const calls=created.slice(0,8).map(key=>gateway.complete(key.key,'model',[{role:'user',content:'hi'}],10))
 await expect(gateway.complete(created[8]!.key,'model',[{role:'user',content:'hi'}],10)).rejects.toThrow('Concurrency limit')
 release();await Promise.all(calls)
 await expect(gateway.complete(created[8]!.key,'model',[{role:'user',content:'hi'}],10)).resolves.toBeDefined()
})

test('releases a cancelled stream slot without releasing its uncertain reservation',async()=>{
 const db=new Database(':memory:'),ledger=new Accounting(db,10000),keys=new GatewayKeys(db);ledger.creditReceipt('r','i','alice',10000);const key=keys.create('alice',10000)
 const provider={...mockProvider(),async *stream(){yield {data:'{"choices":[]}'};yield {data:'{"choices":[]}'}}}
 const gateway=new Gateway(ledger,keys,provider,'model',pricing),messages=[{role:'user' as const,content:'hi'}]
 const a=gateway.stream(key.key,'model',messages,10).getReader(),b=gateway.stream(key.key,'model',messages,10).getReader()
 await a.read();await b.read()
 expect(()=>gateway.stream(key.key,'model',messages,10)).toThrow('Concurrency limit')
 await a.cancel()
 const c=gateway.stream(key.key,'model',messages,10).getReader();await c.read();await c.cancel();await b.cancel()
 expect(ledger.usage('alice').filter((r:any)=>r.state==='reserved')).toHaveLength(3)
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

test('streams tool calls and settles only after reported usage',async()=>{
 const db=new Database(':memory:'),ledger=new Accounting(db,1000),keys=new GatewayKeys(db);ledger.creditReceipt('r','i','alice',1000);const key=keys.create('alice',1000)
 const provider={...mockProvider(),async *stream(){yield {data:JSON.stringify({choices:[{delta:{tool_calls:[{index:0,function:{name:'lookup'}}]}}]})};yield {data:JSON.stringify({choices:[],usage:{prompt_tokens:2,completion_tokens:2}}),usage:{inputTokens:2,outputTokens:2}}}}
 const gateway=new Gateway(ledger,keys,provider,'model',pricing),body=await new Response(gateway.stream(key.key,'model',[{role:'user',content:'use a tool'}],10,{tools:[{type:'function'}]})).text()
 expect(body).toContain('tool_calls');expect(body).toContain('[DONE]');expect(ledger.balance('alice')).toBe(994);expect(ledger.usage('alice')[0]).toMatchObject({state:'settled',charged:6})
})
test('retains reservation when stream has no usage or is cancelled',async()=>{
 const db=new Database(':memory:'),ledger=new Accounting(db,1000),keys=new GatewayKeys(db);ledger.creditReceipt('r','i','alice',1000);const key=keys.create('alice',1000)
 const provider={...mockProvider(),async *stream(){yield {data:'{"choices":[]}'} }}
 const gateway=new Gateway(ledger,keys,provider,'model',pricing)
 await expect(new Response(gateway.stream(key.key,'model',[{role:'user',content:'hello'}],10)).text()).rejects.toThrow()
 expect(ledger.usage('alice')[0]).toMatchObject({state:'reserved',reserved:120})
 const reader=gateway.stream(key.key,'model',[{role:'user',content:'hello'}],10).getReader();await reader.read();await reader.cancel()
 expect(ledger.usage('alice').filter((r:any)=>r.state==='reserved')).toHaveLength(2)
})
