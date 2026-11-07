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
  expect(await (await call('/config')).json()).toMatchObject({ model: 'mock-model', contextTokens: 100, maxOutputTokens: 10 })
  const c=await (await call('/api/auth/challenge','POST')).json() as {id:string}
  const session=await (await call('/api/auth/verify','POST',{challengeId:c.id,accountId:'alice.testnet',publicKey:`ed25519:${'1'.repeat(32)}`,signature:Buffer.alloc(64).toString('base64')})).json() as {token:string}
  const key=await (await call('/api/keys','POST',{quota:500},session.token)).json() as {id:string;key:string}
  expect((await call('/v1/models','GET',undefined,'bad')).status).toBe(401)
  const response=await call('/v1/chat/completions','POST',{model:'mock-model',messages:[{role:'user',content:'hello'}],max_tokens:10},key.key)
  expect(response.status).toBe(200)
  const body=await response.json() as any;expect(body.choices[0].message.content).toBe('Mock response');expect(body.usage.total_tokens).toBe(4)
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
  const port=app.server!.port
  const open=(id:string)=>new Promise<WebSocket>((resolve,reject)=>{const ws=new WebSocket(`ws://127.0.0.1:${port}/rooms/${id}/ws`,{headers:{redemptionAllowlist:new Set(),origin:'http://localhost:3000'}} as any);ws.onopen=()=>resolve(ws);ws.onerror=()=>reject(new Error('socket failed'))})
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
 expect((await attempt(alice)).status).toBe(400)
})

test('chat endpoint passes tool calls and streams metered events',async()=>{
 const {Gateway}=await import('../src/gateway')
 const db=new Database(':memory:'),rpc=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),ledger=new Accounting(db,1000),auth=new WalletAuth(db,rpc,async()=>{}),redemption=new Redemption(db,ledger,rpc),keys=new GatewayKeys(db)
 ledger.creditReceipt('r','i','alice.testnet',1000);const key=keys.create('alice.testnet',1000)
 let received:unknown
 const provider={async complete(_m:unknown,_n:number,options:unknown){received=options;return {text:null,toolCalls:[{id:'call_1',type:'function',function:{name:'lookup',arguments:'{}'}}],inputTokens:2,outputTokens:2,finishReason:'tool_calls'}},async *stream(){yield {data:'{"choices":[{"delta":{"tool_calls":[{"index":0}]}}]}'};yield {data:'{"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":2}}',usage:{inputTokens:2,outputTokens:2}}}}
 const gateway=new Gateway(ledger,keys,provider,'model',{inputMicrosPerMillion:1000000,outputMicrosPerMillion:2000000,microsPerUnit:1000000,contextTokens:100,maxOutputTokens:10})
 const app=createApp({auth,redemption,ledger,keys,gateway,faucet:null,allowRedemption:false,redemptionAllowlist:new Set(),origin:'http://localhost:3000'})
 const send=(stream:boolean)=>app.handle(new Request('http://localhost/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key.key}`},body:JSON.stringify({model:'model',messages:[{role:'user',content:'test'}],tools:[{type:'function',function:{name:'lookup',parameters:{type:'object'}}}],tool_choice:'auto',stream})}))
 const first=await send(false);expect(first.status).toBe(200);expect((await first.json() as any).choices[0].message.tool_calls[0].function.name).toBe('lookup');expect(received).toMatchObject({tool_choice:'auto'})
 const second=await send(true);expect(second.status).toBe(200);expect(second.headers.get('content-type')).toContain('text/event-stream');expect(await second.text()).toContain('data: [DONE]');expect(ledger.balance('alice.testnet')).toBe(988)
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

test('accepts structured text parts and rejects image inputs',async()=>{
 const {Gateway}=await import('../src/gateway');const {mockProvider}=await import('../src/provider')
 const db=new Database(':memory:'),rpc=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),ledger=new Accounting(db,1000),auth=new WalletAuth(db,rpc,async()=>{}),redemption=new Redemption(db,ledger,rpc),keys=new GatewayKeys(db)
 ledger.creditReceipt('r','i','alice.testnet',1000);const key=keys.create('alice.testnet',1000),gateway=new Gateway(ledger,keys,mockProvider(),'model',{inputMicrosPerMillion:1000000,outputMicrosPerMillion:2000000,microsPerUnit:1000000,contextTokens:100,maxOutputTokens:10})
 const app=createApp({auth,redemption,ledger,keys,gateway,faucet:null,allowRedemption:false,redemptionAllowlist:new Set(),origin:'http://localhost:3000'})
 const send=(content:unknown)=>app.handle(new Request('http://localhost/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key.key}`},body:JSON.stringify({model:'model',messages:[{role:'user',content}],max_tokens:10})}))
 expect((await send([{type:'text',text:'hello'}])).status).toBe(200)
 expect((await send([{type:'image_url',image_url:{url:'https://example.com/image.png'}}])).status).toBe(400)
})
