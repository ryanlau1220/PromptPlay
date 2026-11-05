import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { JsonRpcProvider } from 'near-api-js'
import { WalletAuth } from '../src/auth'
import { Accounting } from '../src/accounting'
import { Redemption } from '../src/redemption'
import { createApp } from '../src/app'
test('wallet sessions protect accounting and redemption stays disabled', async () => {
  const db=new Database(':memory:'); const rpc=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}); const ledger=new Accounting(db,100)
  const auth=new WalletAuth(db,rpc,async()=>{}); const redemption=new Redemption(db,ledger,rpc)
  const app=createApp({auth,redemption,ledger,allowRedemption:false,origin:'http://localhost:3000'})
  const request=(path:string,method='GET',body?:unknown,token?:string)=>app.handle(new Request(`http://localhost${path}`,{method,headers:{...(body ? {'content-type':'application/json'} : {}),...(token ? {authorization:`Bearer ${token}`} : {})},body:body ? JSON.stringify(body) : undefined}))
  expect((await request('/api/inference/balance')).status).toBe(401)
  const c=await (await request('/api/auth/challenge','POST')).json() as {id:string}
  const login=await (await request('/api/auth/verify','POST',{challengeId:c.id,accountId:'alice.testnet',publicKey:`ed25519:${'1'.repeat(32)}`,signature:Buffer.alloc(64).toString('base64')})).json() as {token:string}
  expect((await request('/api/inference/balance','GET',undefined,login.token)).status).toBe(200)
  expect((await request('/api/redemptions','POST',{units:1},login.token)).status).toBe(503)
  expect((await request('/api/auth/session','DELETE',undefined,login.token)).status).toBe(200)
  expect((await request('/api/inference/balance','GET',undefined,login.token)).status).toBe(401)
})
