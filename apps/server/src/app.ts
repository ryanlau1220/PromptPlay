import { Elysia, t } from 'elysia'
import { cors } from '@elysiajs/cors'
import type { WalletAuth } from './auth'
import type { Redemption } from './redemption'
import type { Accounting } from './accounting'
import type { GatewayKeys } from './keys'
import type { Gateway } from './gateway'
import type { ChatMessage } from './provider'

type Services = {auth:WalletAuth; redemption:Redemption; ledger:Accounting; allowRedemption:boolean; origin:string; keys:GatewayKeys; gateway:Gateway|null}
export function createApp({auth, redemption, ledger, allowRedemption, origin, keys, gateway}:Services) {
  let windowStart=Date.now(), attempts=0
  const limited=()=>{if(Date.now()-windowStart>=60_000){windowStart=Date.now();attempts=0}return ++attempts>120}
  const token=(header:string|undefined)=>header?.startsWith('Bearer ') ? header.slice(7) : ''
  const account=(header:string|undefined)=>auth.account(token(header))
  return new Elysia({normalize:false}).use(cors({origin,methods:['GET','POST','DELETE'],allowedHeaders:['Content-Type','Authorization']}))
    .onError(({code,set})=>{if(code==='VALIDATION'){set.status=400;return {error:'Invalid request'}};set.status=400;return {error:'Request could not be completed'}})
    .get('/health',()=>({ok:true}))
    .post('/api/auth/challenge',({set})=>{if(limited()){set.status=429;return {error:'Try again later'}};return auth.challenge()})
    .post('/api/auth/verify',async({body,set})=>{if(limited()){set.status=429;return {error:'Try again later'}};return auth.signIn(body)}, {body:t.Object({challengeId:t.String({minLength:1,maxLength:64}),accountId:t.String({minLength:2,maxLength:64}),publicKey:t.String({minLength:1,maxLength:64}),signature:t.String({minLength:1,maxLength:128})})})
    .delete('/api/auth/session',({headers,set})=>{const raw=token(headers.authorization);if(!account(headers.authorization)){set.status=401;return {error:'Unauthorized'}};auth.revoke(raw);return {ok:true}})
    .get('/api/inference/usage',({headers,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};return {requests:ledger.usage(who)}})
    .post('/api/keys',({headers,body,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};if(limited()){set.status=429;return {error:'Try again later'}};return keys.create(who,body.quota)}, {body:t.Object({quota:t.Integer({minimum:1,maximum:1000000000})})})
    .delete('/api/keys/:id',({headers,params,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};if(!keys.revoke(who,params.id)){set.status=404;return {error:'Not found'}};return {ok:true}})
    .get('/v1/models',({headers,set})=>{const key=keys.authenticate(token(headers.authorization));if(!key){set.status=401;return {error:'Invalid API key'}};if(!gateway){set.status=503;return {error:'Inference is unavailable'}};return {object:'list',data:[{id:gateway.model,object:'model',owned_by:'promptplay'}]}})
    .post('/v1/chat/completions',async({headers,body,set})=>{const raw=token(headers.authorization);if(!keys.authenticate(raw)){set.status=401;return {error:'Invalid API key'}};if(!gateway){set.status=503;return {error:'Inference is unavailable'}};if(body.stream){set.status=400;return {error:'Streaming is not supported'}};return gateway.complete(raw,body.model,body.messages as ChatMessage[],body.max_tokens)}, {body:t.Object({model:t.String({minLength:1,maxLength:200}),messages:t.Array(t.Object({role:t.String({maxLength:20}),content:t.String({maxLength:20000})},{additionalProperties:false}),{minItems:1,maxItems:32}),max_tokens:t.Integer({minimum:1,maximum:4096}),stream:t.Optional(t.Boolean())},{additionalProperties:false})})
    .get('/api/inference/balance',({headers,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};return {units:ledger.balance(who)}})
    .post('/api/redemptions',({headers,body,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};if(!allowRedemption){set.status=503;return {error:'Redemption is unavailable'}};if(limited()){set.status=429;return {error:'Try again later'}};return redemption.create(who,body.units)}, {body:t.Object({units:t.Integer({minimum:1,maximum:100})})})
    .get('/api/redemptions/:id',({headers,params,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};const intent=redemption.get(params.id,who);if(!intent){set.status=404;return {error:'Not found'}};return intent})
    .post('/api/redemptions/:id/verify',async({headers,params,body,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};if(limited()){set.status=429;return {error:'Try again later'}};return redemption.verify(params.id,who,body.transactionHash)}, {body:t.Object({transactionHash:t.String({minLength:32,maxLength:50})})})
}
