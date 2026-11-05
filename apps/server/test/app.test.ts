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
  const app=createApp({auth,redemption,ledger,allowRedemption:false,keys:new GatewayKeys(db),gateway:null,origin:'http://localhost:3000'})
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
  const app=createApp({auth,redemption,ledger,keys,gateway,allowRedemption:false,origin:'http://localhost:3000'})
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
