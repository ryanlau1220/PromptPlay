import { Elysia, t } from 'elysia'
import { cors } from '@elysiajs/cors'
import type { WalletAuth } from './auth'
import type { Redemption } from './redemption'
import type { Accounting } from './accounting'
import type { GatewayKeys } from './keys'
import type { Gateway } from './gateway'
import type { ChatMessage } from './provider'
import type { Faucet } from './faucet'

type Services = {auth:WalletAuth; redemption:Redemption; ledger:Accounting; allowRedemption:boolean; origin:string; keys:GatewayKeys; gateway:Gateway|null; faucet:Faucet|null; redemptionAllowlist:Set<string>}
export function createApp({auth, redemption, ledger, allowRedemption, origin, keys, gateway, faucet, redemptionAllowlist}:Services) {
  let windowStart=Date.now(), attempts=0
  const socketRates=new Map<string,number>()
  const limited=()=>{if(Date.now()-windowStart>=60_000){windowStart=Date.now();attempts=0}return ++attempts>120}
  const token=(header:string|undefined)=>header?.startsWith('Bearer ') ? header.slice(7) : ''
  const account=(header:string|undefined)=>auth.account(token(header))
  return new Elysia({normalize:false,websocket:{maxPayloadLength:512,idleTimeout:120}}).use(cors({origin,methods:['GET','POST','DELETE'],allowedHeaders:['Content-Type','Authorization']}))
    .onError(({code,set,request})=>{set.status=400;const message=code==='VALIDATION' ? 'Invalid request' : 'Request could not be completed';return new URL(request.url).pathname.startsWith('/v1/') ? {error:{message,type:'invalid_request_error',code:'invalid_request'}} : {error:message}})
    .ws('/rooms/:id/ws',{
      params:t.Object({id:t.String({pattern:'^[0-9]{1,20}$'})}),
      body:t.Object({type:t.Literal('resync')},{additionalProperties:false}),
      beforeHandle:({headers,set})=>{if(headers.origin !== origin){set.status=403;return 'Forbidden'}},
      open(ws){ws.subscribe(`room:${ws.data.params.id}`);ws.send({type:'resync_required'});ws.publish(`room:${ws.data.params.id}`,{type:'resync_required'})},
      message(ws){const now=Date.now();if(now-(socketRates.get(ws.id) ?? 0)<2000)return;socketRates.set(ws.id,now);ws.publish(`room:${ws.data.params.id}`,{type:'resync_required'})},
      close(ws){socketRates.delete(ws.id);ws.unsubscribe(`room:${ws.data.params.id}`);ws.publish(`room:${ws.data.params.id}`,{type:'resync_required'})},
    })
    .get('/health',()=>({ok:true}))
    .get('/config',()=>({network:'testnet',redemptionAvailable:allowRedemption && gateway !== null,pccPerUnit:'5',faucetAvailable:faucet !== null,microsPerUnit:gateway?.maxUnitCostMicros ?? null,maxOutputTokens:gateway?.maxOutputTokens ?? null}))
    .post('/api/auth/challenge',({set})=>{if(limited()){set.status=429;return {error:'Try again later'}};return auth.challenge()})
    .post('/api/auth/verify',async({body,set})=>{if(limited()){set.status=429;return {error:'Try again later'}};return auth.signIn(body)}, {body:t.Object({challengeId:t.String({minLength:1,maxLength:64}),accountId:t.String({minLength:2,maxLength:64}),publicKey:t.String({minLength:1,maxLength:64}),signature:t.String({minLength:1,maxLength:128})})})
    .delete('/api/auth/session',({headers,set})=>{const raw=token(headers.authorization);if(!account(headers.authorization)){set.status=401;return {error:'Unauthorized'}};auth.revoke(raw);return {ok:true}})
    .get('/api/faucet',({headers,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};if(!faucet){set.status=503;return {error:'Faucet unavailable'}};return {claim:faucet.status(who)}})
    .post('/api/faucet',async({headers,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};if(!faucet){set.status=503;return {error:'Faucet unavailable'}};if(limited()){set.status=429;return {error:'Try again later'}};return {claim:await faucet.claim(who)}})
    .get('/api/inference/usage',({headers,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};return {requests:ledger.usage(who)}})
    .get('/api/keys',({headers,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};return {keys:keys.list(who)}})
    .post('/api/keys',({headers,body,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};if(limited()){set.status=429;return {error:'Try again later'}};return keys.create(who,body.quota)}, {body:t.Object({quota:t.Integer({minimum:1,maximum:1000000000})})})
    .delete('/api/keys/:id',({headers,params,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};if(!keys.revoke(who,params.id)){set.status=404;return {error:'Not found'}};return {ok:true}})
    .get('/v1/models',({headers,set})=>{const key=keys.authenticate(token(headers.authorization));if(!key){set.status=401;return {error:{message:'Invalid API key',type:'authentication_error',code:'invalid_api_key'}}};if(!gateway){set.status=503;return {error:{message:'Inference is unavailable',type:'server_error',code:'unavailable'}}};return {object:'list',data:[{id:gateway.model,object:'model',owned_by:'promptplay'}]}})
    .post('/v1/chat/completions',async({headers,body,set})=>{const raw=token(headers.authorization);if(!keys.authenticate(raw)){set.status=401;return {error:{message:'Invalid API key',type:'authentication_error',code:'invalid_api_key'}}};if(!gateway){set.status=503;return {error:{message:'Inference is unavailable',type:'server_error',code:'unavailable'}}};if(body.stream){set.status=400;return {error:{message:'Streaming is not supported',type:'invalid_request_error',code:'unsupported'}}};try{return await gateway.complete(raw,body.model,body.messages as ChatMessage[],body.max_tokens)}catch(e){const msg=e instanceof Error ? e.message : '';const payment=msg==='Insufficient allowance'||msg==='Key quota exceeded or revoked';const limited=msg==='Project spending cap exceeded'||msg==='Rate limit exceeded';const invalid=msg==='Model is not supported'||msg==='Invalid output limit'||msg==='Invalid messages';set.status=payment?402:limited?429:invalid?400:502;return {error:{message:payment?'Insufficient allowance or key quota':limited?'Spending or rate limit reached':invalid?msg:'Inference request could not be completed',type:payment?'insufficient_quota':limited?'rate_limit_error':invalid?'invalid_request_error':'server_error',code:payment?'insufficient_quota':limited?'rate_limit':invalid?'invalid_request':'upstream_error'}}}}, {body:t.Object({model:t.String({minLength:1,maxLength:200}),messages:t.Array(t.Object({role:t.String({maxLength:20}),content:t.String({maxLength:20000})},{additionalProperties:false}),{minItems:1,maxItems:32}),max_tokens:t.Integer({minimum:1,maximum:4096}),stream:t.Optional(t.Boolean())},{additionalProperties:false})})
    .get('/api/inference/balance',({headers,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};return {units:ledger.balance(who)}})
    .get('/api/redemptions',({headers,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};return {intents:redemption.list(who)}})
    .post('/api/redemptions',({headers,body,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};if(!allowRedemption){set.status=503;return {error:'Redemption is unavailable'}};if(!redemptionAllowlist.has(who)){set.status=403;return {error:'This wallet is not enrolled in the demo'}};if(limited()){set.status=429;return {error:'Try again later'}};return redemption.create(who,body.units)}, {body:t.Object({units:t.Integer({minimum:1,maximum:100})})})
    .get('/api/redemptions/:id',({headers,params,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};const intent=redemption.get(params.id,who);if(!intent){set.status=404;return {error:'Not found'}};return intent})
    .post('/api/redemptions/:id/verify',async({headers,params,body,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};if(limited()){set.status=429;return {error:'Try again later'}};return redemption.verify(params.id,who,body.transactionHash)}, {body:t.Object({transactionHash:t.String({minLength:32,maxLength:50})})})
}
