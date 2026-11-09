import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { JsonRpcProvider } from 'near-api-js'
import { WalletAuth } from '../src/auth'
import { Accounting } from '../src/accounting'
import { Redemption } from '../src/redemption'
import { createApp } from '../src/app'
import { GatewayKeys } from '../src/keys'
test('wallet sessions protect accounting and redemption stays disabled', async () => {
  const db=new Database(':memory:'); const rpc=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}); const ledger=new Accounting(db,100)
  const auth=new WalletAuth(db,rpc,async()=>{}); const redemption=new Redemption(db,ledger,rpc)
  const app=createApp({auth,redemption,ledger,allowRedemption:false,keys:new GatewayKeys(db),gateway:null,faucet:null,redemptionAllowlist:new Set(),origin:'http://localhost:3000'})
  const request=(path:string,method='GET',body?:unknown,token?:string)=>app.handle(new Request(`http://localhost${path}`,{method,headers:{...(body ? {'content-type':'application/json'} : {}),...(token ? {authorization:`Bearer ${token}`} : {})},body:body ? JSON.stringify(body) : undefined}))
  expect((await request('/api/inference/balance')).status).toBe(401)
  const c=await (await request('/api/auth/challenge','POST')).json() as {id:string}
  const login=await (await request('/api/auth/verify','POST',{challengeId:c.id,accountId:'alice.testnet',publicKey:`ed25519:${'1'.repeat(32)}`,signature:Buffer.alloc(64).toString('base64')})).json() as {token:string}
  expect((await request('/api/inference/balance','GET',undefined,login.token)).status).toBe(200)
  expect((await request('/api/redemptions','POST',{units:1},login.token)).status).toBe(503)
  expect((await request('/api/auth/session','DELETE',undefined,login.token)).status).toBe(200)
  expect((await request('/api/inference/balance','GET',undefined,login.token)).status).toBe(401)
})

test('mock gateway authenticates keys and meters real reported mock usage', async () => {
  const {Gateway}=await import('../src/gateway'); const {mockProvider}=await import('../src/provider')
  const db=new Database(':memory:'), rpc=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}), ledger=new Accounting(db,1000)
  const auth=new WalletAuth(db,rpc,async()=>{}), redemption=new Redemption(db,ledger,rpc), keys=new GatewayKeys(db)
  ledger.creditReceipt('test-receipt','test-intent','alice.testnet',1000)
  const gateway=new Gateway(ledger,keys,mockProvider(),'mock-model',{inputMicrosPerMillion:1000000,outputMicrosPerMillion:2000000,microsPerUnit:1000000,contextTokens:100,maxOutputTokens:10})
  const app=createApp({auth,redemption,ledger,keys,gateway,faucet:null,allowRedemption:false,redemptionAllowlist:new Set(),origin:'http://localhost:3000'})
  const call=(path:string,method='GET',body?:unknown,token?:string)=>app.handle(new Request(`http://localhost${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined}))
  expect(await (await call('/config')).json()).toMatchObject({ provider:'OpenAI-compatible', model: 'mock-model', capabilities:{streaming:false,toolCalls:false}, contextTokens: 100, maxOutputTokens: 10 })
  const c=await (await call('/api/auth/challenge','POST')).json() as {id:string}
  const session=await (await call('/api/auth/verify','POST',{challengeId:c.id,accountId:'alice.testnet',publicKey:`ed25519:${'1'.repeat(32)}`,signature:Buffer.alloc(64).toString('base64')})).json() as {token:string}
  const key=await (await call('/api/keys','POST',{quota:500},session.token)).json() as {id:string;key:string}
  expect((await call('/v1/models','GET',undefined,'bad')).status).toBe(401)
  const response=await call('/v1/chat/completions','POST',{model:'mock-model',messages:[{role:'user',content:'hello'}],max_tokens:10},key.key)
  expect(response.status).toBe(200)
  const body=await response.json() as {choices:Array<{message:{content:string}}>;usage:{total_tokens:number}};expect(body.choices[0].message.content).toBe('Mock response');expect(body.usage.total_tokens).toBe(4)
  expect(ledger.balance('alice.testnet')).toBe(994)
  expect((await call('/v1/chat/completions','POST',{model:'mock-model',messages:[{role:'user',content:'hello'}],max_tokens:10,stream:true},key.key)).status).toBe(400)
  expect((await call('/v1/chat/completions','POST',{model:'mock-model',messages:[{role:'user',content:'hello'}],max_tokens:10,tools:[]},key.key)).status).toBe(200)
  expect((await call(`/api/keys/${key.id}`,'DELETE',undefined,session.token)).status).toBe(200)
  expect((await call('/v1/models','GET',undefined,key.key)).status).toBe(401)
})

test('room sockets only send resync hints to the same match', async () => {
  const db=new Database(':memory:'),rpc=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),ledger=new Accounting(db,100)
  const auth=new WalletAuth(db,rpc,async()=>{}),redemption=new Redemption(db,ledger,rpc),keys=new GatewayKeys(db)
  const app=createApp({auth,redemption,ledger,keys,gateway:null,faucet:null,allowRedemption:false,redemptionAllowlist:new Set(),origin:'http://localhost:3000'}).listen({hostname:'127.0.0.1',port:0})
  if (!app.server) throw new Error('Server failed to start')
  const port=app.server.port
  const open=(id:string)=>new Promise<WebSocket>((resolve,reject)=>{const ws=new WebSocket(`ws://127.0.0.1:${port}/rooms/${id}/ws`,{headers:{origin:'http://localhost:3000'}} as unknown as string[]);ws.onopen=()=>resolve(ws);ws.onerror=()=>reject(new Error('socket failed'))})
  try {
    const a=await open('7'); const initial=await new Promise<string>(resolve=>{a.onmessage=e=>resolve(String(e.data))})
    expect(JSON.parse(initial)).toEqual({type:'resync_required'})
    const notice=new Promise<string>(resolve=>{a.onmessage=e=>resolve(String(e.data))});const b=await open('7')
    expect(JSON.parse(await notice)).toEqual({type:'resync_required'})
    a.close();b.close()
  } finally {app.stop();db.close()}
},10000)
test('only enrolled wallets can reserve funded redemption capacity',async()=>{
 const db=new Database(':memory:'),rpc=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),ledger=new Accounting(db,1000000),auth=new WalletAuth(db,rpc,async()=>{}),redemption=new Redemption(db,ledger,rpc),keys=new GatewayKeys(db)
 const app=createApp({auth,redemption,ledger,keys,gateway:null,faucet:null,allowRedemption:true,redemptionAllowlist:new Set(['alice.testnet']),origin:'http://localhost:3000'})
 async function login(accountId:string){const challenge=auth.challenge();return (await auth.signIn({challengeId:challenge.id,accountId,publicKey:`ed25519:${'1'.repeat(32)}`,signature:Buffer.alloc(64).toString('base64')})).token}
 const send=async(token:string)=>app.handle(new Request('http://localhost/api/redemptions',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({units:1})}))
 expect((await send(await login('bob.testnet'))).status).toBe(403)
 const alice=await login('alice.testnet')
 const created=await send(alice);expect(created.status).toBe(200)
 const {id}=await created.json() as {id:string}
 const attempt=(bearer:string)=>app.handle(new Request(`http://localhost/api/redemptions/${id}/attempt`,{method:'POST',headers:{authorization:`Bearer ${bearer}`}}))
 expect((await attempt(await login('bob.testnet'))).status).toBe(403)
 expect((await attempt(alice)).status).toBe(200)
 expect((await attempt(alice)).status).toBe(409)
})

test('gateway status distinguishes enabled inference from exhausted redemption allocation',async()=>{
 const {Gateway}=await import('../src/gateway');const {mockProvider}=await import('../src/provider')
 const db=new Database(':memory:'),rpc=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),ledger=new Accounting(db,1000000),auth=new WalletAuth(db,rpc,async()=>{}),redemption=new Redemption(db,ledger,rpc),keys=new GatewayKeys(db)
 const gateway=new Gateway(ledger,keys,mockProvider(),'model',{inputMicrosPerMillion:1000000,outputMicrosPerMillion:2000000,microsPerUnit:1000000,contextTokens:100,maxOutputTokens:10})
 const app=createApp({auth,redemption,ledger,keys,gateway,faucet:null,allowRedemption:true,redemptionAllowlist:new Set(['alice.testnet']),origin:'http://localhost:3000'})
 const status=async()=>await (await app.handle(new Request('http://localhost/config'))).json()
 expect(await status()).toMatchObject({redemptionAvailable:true,redemptionUnitsAvailable:1})
 redemption.create('alice.testnet',1)
 expect(await status()).toMatchObject({redemptionAvailable:true,redemptionUnitsAvailable:0})
})

test('chat endpoint passes tool calls and streams metered events',async()=>{
 const {Gateway}=await import('../src/gateway')
 const db=new Database(':memory:'),rpc=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),ledger=new Accounting(db,1000),auth=new WalletAuth(db,rpc,async()=>{}),redemption=new Redemption(db,ledger,rpc),keys=new GatewayKeys(db)
 ledger.creditReceipt('r','i','alice.testnet',1000);const key=keys.create('alice.testnet',1000)
 let received:unknown
 const provider={async complete(_m:unknown,_n:number,options:unknown){received=options;return {text:null,toolCalls:[{id:'call_1',type:'function',function:{name:'lookup',arguments:'{}'}}],inputTokens:2,outputTokens:2,finishReason:'tool_calls'}},async *stream(){yield {data:'{"choices":[{"delta":{"tool_calls":[{"index":0}]}}]}'};yield {data:'{"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":2}}',usage:{inputTokens:2,outputTokens:2}}}}
 const gateway=new Gateway(ledger,keys,provider,'model',{inputMicrosPerMillion:1000000,outputMicrosPerMillion:2000000,microsPerUnit:1000000,contextTokens:100,maxOutputTokens:10},'Mock',{streaming:true,toolCalls:true})
 const app=createApp({auth,redemption,ledger,keys,gateway,faucet:null,allowRedemption:false,redemptionAllowlist:new Set(),origin:'http://localhost:3000'})
 const send=(stream:boolean,store=false)=>app.handle(new Request('http://localhost/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key.key}`},body:JSON.stringify({model:'model',messages:[{role:'user',content:'test'}],tools:[{type:'function',function:{name:'lookup',parameters:{type:'object'}}}],tool_choice:'auto',stream,store})}))
 const first=await send(false);expect(first.status).toBe(200);expect((await first.json() as {choices:Array<{message:{tool_calls:Array<{function:{name:string}}>}}>}).choices[0].message.tool_calls[0].function.name).toBe('lookup');expect(received).toMatchObject({tool_choice:'auto'})
 const second=await send(true);expect(second.status).toBe(200);expect(second.headers.get('content-type')).toContain('text/event-stream');expect(await second.text()).toContain('data: [DONE]');expect(ledger.balance('alice.testnet')).toBe(988)
 expect((await send(false,true)).status).toBe(400)
})

test('chat endpoint returns 429 when the account concurrency limit is reached',async()=>{
 const {Gateway}=await import('../src/gateway')
 const db=new Database(':memory:'),rpc=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),ledger=new Accounting(db,1000),auth=new WalletAuth(db,rpc,async()=>{}),redemption=new Redemption(db,ledger,rpc),keys=new GatewayKeys(db)
 ledger.creditReceipt('r','i','alice.testnet',1000);const key=keys.create('alice.testnet',1000)
 let release!:()=>void, bothStarted!:()=>void, started=0
 const waiting=new Promise<void>(resolve=>{release=resolve}),ready=new Promise<void>(resolve=>{bothStarted=resolve})
 const provider={async complete(){if(++started===2)bothStarted();await waiting;return {text:'ok',inputTokens:2,outputTokens:2,finishReason:'stop'}}}
 const gateway=new Gateway(ledger,keys,provider,'model',{inputMicrosPerMillion:1000000,outputMicrosPerMillion:2000000,microsPerUnit:1000000,contextTokens:100,maxOutputTokens:10})
 const app=createApp({auth,redemption,ledger,keys,gateway,faucet:null,allowRedemption:false,redemptionAllowlist:new Set(),origin:'http://localhost:3000'})
 const send=()=>app.handle(new Request('http://localhost/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key.key}`},body:JSON.stringify({model:'model',messages:[{role:'user',content:'test'}],max_tokens:10})}))
 const a=send(),b=send();await ready
 const rejected=await send();expect(rejected.status).toBe(429);expect(await rejected.json()).toMatchObject({error:{code:'rate_limit'}})
 release();expect((await a).status).toBe(200);expect((await b).status).toBe(200)
})

test('accepts a large bounded agent tool catalog and meters the request',async()=>{
 const {Gateway}=await import('../src/gateway');const {mockProvider}=await import('../src/provider')
 const db=new Database(':memory:'),rpc=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),ledger=new Accounting(db,1000),auth=new WalletAuth(db,rpc,async()=>{}),redemption=new Redemption(db,ledger,rpc),keys=new GatewayKeys(db)
 ledger.creditReceipt('r','i','alice.testnet',1000);const key=keys.create('alice.testnet',1000)
 const gateway=new Gateway(ledger,keys,mockProvider(),'model',{inputMicrosPerMillion:1000000,outputMicrosPerMillion:2000000,microsPerUnit:1000000,contextTokens:100,maxOutputTokens:10},'Mock',{streaming:false,toolCalls:true})
 const app=createApp({auth,redemption,ledger,keys,gateway,faucet:null,allowRedemption:false,redemptionAllowlist:new Set(),origin:'http://localhost:3000'})
 const send=(tools:unknown[])=>app.handle(new Request('http://localhost/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key.key}`},body:JSON.stringify({model:'model',messages:[{role:'user',content:'test'}],max_tokens:10,tools})}))
 const tools=Array.from({length:94},(_,i)=>({type:'function',function:{name:`tool_${i}`,description:'x'.repeat(1700)}}))
 expect((await send(tools)).status).toBe(200);expect(ledger.balance('alice.testnet')).toBe(994)
 expect((await send(Array.from({length:129},()=>({type:'function'})))).status).toBe(400)
 expect((await send([{type:'function',description:'x'.repeat(256000)}])).status).toBe(400)
 expect(ledger.balance('alice.testnet')).toBe(994)
})

test('accepts structured text parts and rejects image inputs',async()=>{
 const {Gateway}=await import('../src/gateway');const {mockProvider}=await import('../src/provider')
 const db=new Database(':memory:'),rpc=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),ledger=new Accounting(db,1000),auth=new WalletAuth(db,rpc,async()=>{}),redemption=new Redemption(db,ledger,rpc),keys=new GatewayKeys(db)
 ledger.creditReceipt('r','i','alice.testnet',1000);const key=keys.create('alice.testnet',1000),gateway=new Gateway(ledger,keys,mockProvider(),'model',{inputMicrosPerMillion:1000000,outputMicrosPerMillion:2000000,microsPerUnit:1000000,contextTokens:100,maxOutputTokens:10})
 const app=createApp({auth,redemption,ledger,keys,gateway,faucet:null,allowRedemption:false,redemptionAllowlist:new Set(),origin:'http://localhost:3000'})
 const send=(content:unknown)=>app.handle(new Request('http://localhost/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key.key}`},body:JSON.stringify({model:'model',messages:[{role:'user',content}],max_tokens:10})}))
 expect((await send([{type:'text',text:'hello'}])).status).toBe(200)
 expect((await send([{type:'image_url',image_url:{url:'https://example.com/image.png'}}])).status).toBe(400)
})

test('error responses distinguish invalid input, missing routes and internal failures', async () => {
  const db = new Database(':memory:')
  const rpc = new JsonRpcProvider({url:'https://test.rpc.fastnear.com'})
  const ledger = new Accounting(db, 100)
  const auth = new WalletAuth(db, rpc, async () => {})
  const redemption = new Redemption(db, ledger, rpc)
  const app = createApp({auth, redemption, ledger, keys:new GatewayKeys(db), gateway:null, faucet:null, allowRedemption:false, redemptionAllowlist:new Set(), origin:'http://localhost:3000'})
  const malformed = await app.handle(new Request('http://localhost/api/auth/verify', {method:'POST',headers:{'content-type':'application/json'},body:'{'}))
  expect(malformed.status).toBe(400)
  expect(await malformed.json()).toEqual({error:'Invalid request'})
  const invalid = await app.handle(new Request('http://localhost/api/auth/verify', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({challengeId:'x',accountId:'not-testnet',publicKey:'x',signature:'x'})}))
  expect(invalid.status).toBe(400)
  const missing = await app.handle(new Request('http://localhost/v1/missing'))
  expect(missing.status).toBe(404)
  expect(await missing.json()).toMatchObject({error:{code:'not_found'}})
  db.close()
  const failed = await app.handle(new Request('http://localhost/api/auth/challenge',{method:'POST'}))
  expect(failed.status).toBe(500)
  expect(await failed.json()).toEqual({error:'Internal server error'})
})

test('wallet signature rejection is a client error but RPC failures stay server errors', async () => {
  for (const [message, status] of [['Signature verification failed', 400], ['RPC unavailable', 500]] as const) {
    const db = new Database(':memory:')
    const rpc = new JsonRpcProvider({url:'https://test.rpc.fastnear.com'})
    const ledger = new Accounting(db, 100)
    const auth = new WalletAuth(db, rpc, async () => { throw new Error(message) })
    const app = createApp({auth, redemption:new Redemption(db,ledger,rpc), ledger, keys:new GatewayKeys(db), gateway:null, faucet:null, allowRedemption:false, redemptionAllowlist:new Set(), origin:'http://localhost:3000'})
    const challenge = auth.challenge()
    const response = await app.handle(new Request('http://localhost/api/auth/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({challengeId:challenge.id,accountId:'alice.testnet',publicKey:`ed25519:${'1'.repeat(32)}`,signature:Buffer.alloc(64).toString('base64')})}))
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({error:status === 400 ? 'Invalid wallet signature' : 'Internal server error'})
    db.close()
  }
})

test('gateway reports provider failures separately from internal accounting failures', async () => {
  const {Gateway} = await import('../src/gateway')
  const db = new Database(':memory:'), rpc = new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}), ledger = new Accounting(db, 1000)
  const auth = new WalletAuth(db, rpc, async()=>{}), keys = new GatewayKeys(db), redemption = new Redemption(db, ledger, rpc)
  ledger.creditReceipt('r','i','alice.testnet',1000)
  const key = keys.create('alice.testnet',1000)
  const provider = {async complete():Promise<never> { throw new Error('provider detail') }}
  const gateway = new Gateway(ledger,keys,provider,'model',{inputMicrosPerMillion:1000000,outputMicrosPerMillion:2000000,microsPerUnit:1000000,contextTokens:100,maxOutputTokens:10})
  const app = createApp({auth,redemption,ledger,keys,gateway,faucet:null,allowRedemption:false,redemptionAllowlist:new Set(),origin:'http://localhost:3000'})
  const send = ()=>app.handle(new Request('http://localhost/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key.key}`},body:JSON.stringify({model:'model',messages:[{role:'user',content:'hi'}],max_tokens:10})}))
  const upstream = await send()
  expect(upstream.status).toBe(502)
  expect(await upstream.json()).toMatchObject({error:{code:'upstream_error'}})
  ledger.reserve = () => {throw new Error('database detail')}
  const internal = await send()
  expect(internal.status).toBe(500)
  expect(await internal.json()).toMatchObject({error:{code:'internal_error'}})
  db.close()
})

test('Responses text subset is authenticated, metered and rejects unsupported features',async()=>{
 const {Gateway}=await import('../src/gateway');const {mockProvider}=await import('../src/provider')
 const db=new Database(':memory:'),rpc=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),ledger=new Accounting(db,1000),auth=new WalletAuth(db,rpc,async()=>{}),redemption=new Redemption(db,ledger,rpc),keys=new GatewayKeys(db)
 ledger.creditReceipt('responses-r','responses-i','alice.testnet',1000);const key=keys.create('alice.testnet',1000)
 const gateway=new Gateway(ledger,keys,mockProvider(),'model',{inputMicrosPerMillion:1000000,outputMicrosPerMillion:2000000,microsPerUnit:1000000,contextTokens:100,maxOutputTokens:10})
 const app=createApp({auth,redemption,ledger,keys,gateway,faucet:null,allowRedemption:false,redemptionAllowlist:new Set(),origin:'http://localhost:3000'})
 const send=(body:unknown,token=key.key)=>app.handle(new Request('http://localhost/v1/responses',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body)}))
 expect((await send({model:'model',input:'hello'},'invalid')).status).toBe(401)
 const response=await send({model:'model',input:'hello',instructions:'Be brief',max_output_tokens:10,store:false})
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({object:'response',status:'completed',output:[{role:'assistant',content:[{type:'output_text',text:'Mock response'}]}],usage:{input_tokens:2,output_tokens:2,total_tokens:4}})
 expect(ledger.balance('alice.testnet')).toBe(994)
 for(const extra of [{stream:true},{store:true},{previous_response_id:'resp_old'},{tools:[{type:'web_search'}]},{input:[{role:'user',content:[{type:'input_image',image_url:'https://example.test/a.png'}]}]}]) expect((await send({model:'model',input:'hello',...extra})).status).toBe(400)
 expect((await send({model:'model',input:[{role:'user',content:'hi',id:'x'.repeat(260000)}]})).status).toBe(400)
 expect(ledger.balance('alice.testnet')).toBe(994)
 db.close()
})

test('Responses function calls preserve tool ids and account for every turn',async()=>{
 const {Gateway}=await import('../src/gateway')
 const db=new Database(':memory:'),rpc=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),ledger=new Accounting(db,1000),auth=new WalletAuth(db,rpc,async()=>{}),redemption=new Redemption(db,ledger,rpc),keys=new GatewayKeys(db)
 ledger.creditReceipt('tool-r','tool-i','alice.testnet',1000);const key=keys.create('alice.testnet',1000)
 const seen:unknown[]=[]
 const provider={async complete(messages:unknown,_max:number,options:unknown){seen.push({messages,options});return seen.length===1?{text:null,toolCalls:[{id:'call_1',type:'function',function:{name:'lookup',arguments:'{"query":"x"}'}}],inputTokens:2,outputTokens:2,finishReason:'tool_calls'}:{text:'found',inputTokens:2,outputTokens:2,finishReason:'stop'}}}
 const gateway=new Gateway(ledger,keys,provider,'model',{inputMicrosPerMillion:1000000,outputMicrosPerMillion:2000000,microsPerUnit:1000000,contextTokens:100,maxOutputTokens:10},'Mock',{streaming:false,toolCalls:true})
 const app=createApp({auth,redemption,ledger,keys,gateway,faucet:null,allowRedemption:false,redemptionAllowlist:new Set(),origin:'http://localhost:3000'})
 const send=(input:unknown)=>app.handle(new Request('http://localhost/v1/responses',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key.key}`},body:JSON.stringify({model:'model',input,max_output_tokens:10,tools:[{type:'function',name:'lookup',parameters:{type:'object',properties:{query:{type:'string'}}},strict:false}],tool_choice:'auto'})}))
 const first=await send('Find x');expect(first.status).toBe(200)
 const body=await first.json() as {output:unknown[]};expect(body.output).toMatchObject([{type:'function_call',call_id:'call_1',name:'lookup',arguments:'{"query":"x"}'}])
 const second=await send([{role:'user',content:'Find x'},body.output[0],{type:'function_call_output',call_id:'call_1',output:'value'}]);expect(second.status).toBe(200)
 expect(await second.json()).toMatchObject({output:[{type:'message',content:[{text:'found'}]}]})
 expect(seen[1]).toMatchObject({messages:[{role:'user',content:'Find x'},{role:'assistant',tool_calls:[{id:'call_1',function:{name:'lookup'}}]},{role:'tool',tool_call_id:'call_1',content:'value'}],options:{tools:[{type:'function',function:{name:'lookup'}}],tool_choice:'auto'}})
 expect(ledger.balance('alice.testnet')).toBe(988);db.close()
})

test('Responses streaming translates deltas and settles only after provider completion',async()=>{
 const {Gateway}=await import('../src/gateway')
 const db=new Database(':memory:'),rpc=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),ledger=new Accounting(db,1000),auth=new WalletAuth(db,rpc,async()=>{}),redemption=new Redemption(db,ledger,rpc),keys=new GatewayKeys(db)
 ledger.creditReceipt('stream-r','stream-i','alice.testnet',1000);const key=keys.create('alice.testnet',1000)
 const provider={async complete(){return {text:'unused',inputTokens:2,outputTokens:2,finishReason:'stop'}},async *stream(){yield {data:JSON.stringify({choices:[{delta:{role:'assistant',content:'Hello '},finish_reason:null}]})};yield {data:JSON.stringify({choices:[{delta:{content:'world',tool_calls:[{index:0,id:'call_1',type:'function',function:{name:'lookup',arguments:'{"x":'}}]},finish_reason:null}]})};yield {data:JSON.stringify({choices:[{delta:{tool_calls:[{index:0,function:{arguments:'1}'}}]},finish_reason:'tool_calls'}]})};yield {data:JSON.stringify({choices:[],usage:{prompt_tokens:2,completion_tokens:2,total_tokens:4}}),usage:{inputTokens:2,outputTokens:2}}}}
 const gateway=new Gateway(ledger,keys,provider,'model',{inputMicrosPerMillion:1000000,outputMicrosPerMillion:2000000,microsPerUnit:1000000,contextTokens:100,maxOutputTokens:10},'Mock',{streaming:true,toolCalls:true})
 const app=createApp({auth,redemption,ledger,keys,gateway,faucet:null,allowRedemption:false,redemptionAllowlist:new Set(),origin:'http://localhost:3000'})
 const response=await app.handle(new Request('http://localhost/v1/responses',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key.key}`},body:JSON.stringify({model:'model',input:'hi',max_output_tokens:10,stream:true,tools:[{type:'function',name:'lookup',parameters:{type:'object'}}]})}))
 expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('text/event-stream')
 const frames=(await response.text()).trim().split('\n\n').map(frame=>JSON.parse(frame.split('\n').find(line=>line.startsWith('data: '))?.slice(6) ?? '{}')) as Array<{type:string;sequence_number:number;response?:{output:unknown[];usage:unknown}}>
 expect(frames.map(frame=>frame.sequence_number)).toEqual(frames.map((_,i)=>i))
 expect(frames.map(frame=>frame.type)).toContain('response.function_call_arguments.delta')
 expect(frames.at(-1)).toMatchObject({type:'response.completed',response:{output:[{type:'message',content:[{text:'Hello world'}]},{type:'function_call',call_id:'call_1',name:'lookup',arguments:'{"x":1}'}],usage:{input_tokens:2,output_tokens:2,total_tokens:4}}})
 expect(ledger.balance('alice.testnet')).toBe(994);db.close()
})

test('interrupted Responses stream retains the uncertain reservation',async()=>{
 const {Gateway}=await import('../src/gateway')
 const db=new Database(':memory:'),rpc=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),ledger=new Accounting(db,1000),auth=new WalletAuth(db,rpc,async()=>{}),redemption=new Redemption(db,ledger,rpc),keys=new GatewayKeys(db)
 ledger.creditReceipt('broken-r','broken-i','alice.testnet',1000);const key=keys.create('alice.testnet',1000)
 const provider={async complete(){return {text:'unused',inputTokens:2,outputTokens:2,finishReason:'stop'}},async *stream(){yield {data:JSON.stringify({choices:[{delta:{content:'partial'},finish_reason:null}]})};throw new Error('upstream disconnected')}}
 const gateway=new Gateway(ledger,keys,provider,'model',{inputMicrosPerMillion:1000000,outputMicrosPerMillion:2000000,microsPerUnit:1000000,contextTokens:100,maxOutputTokens:10},'Mock',{streaming:true,toolCalls:false})
 const app=createApp({auth,redemption,ledger,keys,gateway,faucet:null,allowRedemption:false,redemptionAllowlist:new Set(),origin:'http://localhost:3000'})
 const response=await app.handle(new Request('http://localhost/v1/responses',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key.key}`},body:JSON.stringify({model:'model',input:'hi',max_output_tokens:10,stream:true})}))
 await expect(response.text()).rejects.toThrow()
 expect(ledger.usage('alice.testnet')[0]).toMatchObject({state:'reserved',reserved:120});expect(ledger.balance('alice.testnet')).toBe(880)
 db.close()
})

test('cancelled Responses stream keeps the uncertain reservation',async()=>{
 const {Gateway}=await import('../src/gateway')
 const db=new Database(':memory:'),rpc=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),ledger=new Accounting(db,1000),auth=new WalletAuth(db,rpc,async()=>{}),redemption=new Redemption(db,ledger,rpc),keys=new GatewayKeys(db)
 ledger.creditReceipt('cancel-r','cancel-i','alice.testnet',1000);const key=keys.create('alice.testnet',1000)
 let release=()=>{};const waiting=new Promise<void>(resolve=>{release=resolve})
 const provider={async complete(){return {text:'unused',inputTokens:2,outputTokens:2,finishReason:'stop'}},async *stream(){yield {data:JSON.stringify({choices:[{delta:{content:'partial'},finish_reason:null}]})};await waiting;yield {data:JSON.stringify({choices:[],usage:{prompt_tokens:2,completion_tokens:2,total_tokens:4}}),usage:{inputTokens:2,outputTokens:2}}}}
 const gateway=new Gateway(ledger,keys,provider,'model',{inputMicrosPerMillion:1000000,outputMicrosPerMillion:2000000,microsPerUnit:1000000,contextTokens:100,maxOutputTokens:10},'Mock',{streaming:true,toolCalls:false})
 const app=createApp({auth,redemption,ledger,keys,gateway,faucet:null,allowRedemption:false,redemptionAllowlist:new Set(),origin:'http://localhost:3000'})
 const response=await app.handle(new Request('http://localhost/v1/responses',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key.key}`},body:JSON.stringify({model:'model',input:'hi',max_output_tokens:10,stream:true})}))
 if(!response.body)throw new Error('Missing stream')
 const reader=response.body.getReader();let received=''
 while(!received.includes('response.output_text.delta')){const part=await reader.read();if(part.done)throw new Error('Stream ended early');received+=new TextDecoder().decode(part.value)}
 const cancellation=reader.cancel();release();await cancellation
 expect(ledger.usage('alice.testnet')[0]).toMatchObject({state:'reserved',reserved:120});expect(ledger.balance('alice.testnet')).toBe(880)
 db.close()
})

test('Responses streaming respects downstream backpressure and releases the reader on cancel', async () => {
 const { responsesStream }=await import('../src/responses')
 let pulls=0,cancelled=false
 const source=new ReadableStream<Uint8Array>({pull(controller){pulls++;controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'))},cancel(){cancelled=true}})
 const output=responsesStream(source,'model')
 await Bun.sleep(20)
 expect(pulls).toBeLessThanOrEqual(1)
 await output.cancel()
 expect(cancelled).toBe(true)
 expect(source.locked).toBe(false)
})

test('chat forwards bounded assistant reasoning context for a tool follow-up',async()=>{
 const {Gateway}=await import('../src/gateway')
 const db=new Database(':memory:'),rpc=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),ledger=new Accounting(db,1000),auth=new WalletAuth(db,rpc,async()=>{}),redemption=new Redemption(db,ledger,rpc),keys=new GatewayKeys(db)
 ledger.creditReceipt('reason-r','reason-i','alice.testnet',1000);const key=keys.create('alice.testnet',1000)
 let seen:unknown
 const provider={async complete(messages:unknown){seen=messages;return {text:'done',inputTokens:2,outputTokens:2,finishReason:'stop'}}}
 const gateway=new Gateway(ledger,keys,provider,'model',{inputMicrosPerMillion:1000000,outputMicrosPerMillion:2000000,microsPerUnit:1000000,contextTokens:100,maxOutputTokens:10},'Mock',{streaming:false,toolCalls:true})
 const app=createApp({auth,redemption,ledger,keys,gateway,faucet:null,allowRedemption:false,redemptionAllowlist:new Set(),origin:'http://localhost:3000'})
 const send=(messages:unknown)=>app.handle(new Request('http://localhost/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key.key}`},body:JSON.stringify({model:'model',messages,max_tokens:10})}))
 const messages=[{role:'assistant',content:'',reasoning_content:'provider reasoning',tool_calls:[{id:'call_1',type:'function',function:{name:'lookup',arguments:'{}'}}]},{role:'tool',tool_call_id:'call_1',content:'result'}]
 expect((await send(messages)).status).toBe(200);expect(seen).toEqual(messages)
 expect((await send([{role:'user',content:'hi',reasoning_content:'not assistant'}])).status).toBe(400)
 expect((await send([{role:'assistant',content:'',reasoning_content:'x'.repeat(100001)}])).status).toBe(400)
 db.close()
})
