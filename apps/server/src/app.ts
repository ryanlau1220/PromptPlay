import { Elysia, t } from 'elysia'
import { cors } from '@elysiajs/cors'
import type { WalletAuth } from './auth'
import type { Redemption } from './redemption'
import type { Accounting } from './accounting'

type Services = {auth:WalletAuth; redemption:Redemption; ledger:Accounting; allowRedemption:boolean; origin:string}
export function createApp({auth, redemption, ledger, allowRedemption, origin}:Services) {
  let windowStart=Date.now(), attempts=0
  const limited=()=>{if(Date.now()-windowStart>=60_000){windowStart=Date.now();attempts=0}return ++attempts>120}
  const token=(header:string|undefined)=>header?.startsWith('Bearer ') ? header.slice(7) : ''
  const account=(header:string|undefined)=>auth.account(token(header))
  return new Elysia().use(cors({origin,methods:['GET','POST','DELETE'],allowedHeaders:['Content-Type','Authorization']}))
    .onError(({code,set})=>{if(code==='VALIDATION'){set.status=400;return {error:'Invalid request'}};set.status=400;return {error:'Request could not be completed'}})
    .get('/health',()=>({ok:true}))
    .post('/api/auth/challenge',({set})=>{if(limited()){set.status=429;return {error:'Try again later'}};return auth.challenge()})
    .post('/api/auth/verify',async({body,set})=>{if(limited()){set.status=429;return {error:'Try again later'}};return auth.signIn(body)}, {body:t.Object({challengeId:t.String({minLength:1,maxLength:64}),accountId:t.String({minLength:2,maxLength:64}),publicKey:t.String({minLength:1,maxLength:64}),signature:t.String({minLength:1,maxLength:128})})})
    .delete('/api/auth/session',({headers,set})=>{const raw=token(headers.authorization);if(!account(headers.authorization)){set.status=401;return {error:'Unauthorized'}};auth.revoke(raw);return {ok:true}})
    .get('/api/inference/balance',({headers,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};return {units:ledger.balance(who)}})
    .post('/api/redemptions',({headers,body,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};if(!allowRedemption){set.status=503;return {error:'Redemption is unavailable'}};if(limited()){set.status=429;return {error:'Try again later'}};return redemption.create(who,body.units)}, {body:t.Object({units:t.Integer({minimum:1,maximum:100})})})
    .get('/api/redemptions/:id',({headers,params,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};const intent=redemption.get(params.id,who);if(!intent){set.status=404;return {error:'Not found'}};return intent})
    .post('/api/redemptions/:id/verify',async({headers,params,body,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};if(limited()){set.status=429;return {error:'Try again later'}};return redemption.verify(params.id,who,body.transactionHash)}, {body:t.Object({transactionHash:t.String({minLength:32,maxLength:50})})})
}
