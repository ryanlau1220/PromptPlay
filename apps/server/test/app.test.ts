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
  const app=createApp({auth,redemption,ledger,allowRedemption:false,keys:new GatewayKeys(db),gateway:null,faucet:null,origin:'http://localhost:3000'})
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
  const app=createApp({auth,redemption,ledger,keys,gateway,faucet:null,allowRedemption:false,origin:'http://localhost:3000'})
  const call=(path:string,method='GET',body?:unknown,token?:string)=>app.handle(new Request(`http://localhost${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined}))
  const c=await (await call('/api/auth/challenge','POST')).json() as {id:string}
  const session=await (await call('/api/auth/verify','POST',{challengeId:c.id,accountId:'alice.testnet',publicKey:`ed25519:${'1'.repeat(32)}`,signature:Buffer.alloc(64).toString('base64')})).json() as {token:string}
  const key=await (await call('/api/keys','POST',{quota:500},session.token)).json() as {id:string;key:string}
  expect((await call('/v1/models','GET',undefined,'bad')).status).toBe(401)
  const response=await call('/v1/chat/completions','POST',{model:'mock-model',messages:[{role:'user',content:'hello'}],max_tokens:10},key.key)
  expect(response.status).toBe(200)
  const body=await response.json() as any;expect(body.choices[0].message.content).toBe('Mock response');expect(body.usage.total_tokens).toBe(4)
  expect(ledger.balance('alice.testnet')).toBe(994)
  expect((await call('/v1/chat/completions','POST',{model:'mock-model',messages:[{role:'user',content:'hello'}],max_tokens:10,stream:true},key.key)).status).toBe(400)
  expect((await call('/v1/chat/completions','POST',{model:'mock-model',messages:[{role:'user',content:'hello'}],max_tokens:10,tools:[]},key.key)).status).toBe(400)
  expect((await call(`/api/keys/${key.id}`,'DELETE',undefined,session.token)).status).toBe(200)
  expect((await call('/v1/models','GET',undefined,key.key)).status).toBe(401)
})

test('room sockets only send resync hints to the same match', async () => {
  const db=new Database(':memory:'),rpc=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),ledger=new Accounting(db,100)
  const auth=new WalletAuth(db,rpc,async()=>{}),redemption=new Redemption(db,ledger,rpc),keys=new GatewayKeys(db)
  const app=createApp({auth,redemption,ledger,keys,gateway:null,faucet:null,allowRedemption:false,origin:'http://localhost:3000'}).listen({hostname:'127.0.0.1',port:0})
  const port=app.server!.port
  const open=(id:string)=>new Promise<WebSocket>((resolve,reject)=>{const ws=new WebSocket(`ws://127.0.0.1:${port}/rooms/${id}/ws`,{headers:{origin:'http://localhost:3000'}} as any);ws.onopen=()=>resolve(ws);ws.onerror=()=>reject(new Error('socket failed'))})
  try {
    const a=await open('7'); const initial=await new Promise<string>(resolve=>{a.onmessage=e=>resolve(String(e.data))})
    expect(JSON.parse(initial)).toEqual({type:'resync_required'})
    const notice=new Promise<string>(resolve=>{a.onmessage=e=>resolve(String(e.data))});const b=await open('7')
    expect(JSON.parse(await notice)).toEqual({type:'resync_required'})
    a.close();b.close()
  } finally {app.stop();db.close()}
},10000)
