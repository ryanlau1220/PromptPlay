import { Elysia, t } from 'elysia'
import { cors } from '@elysiajs/cors'
import type { WalletAuth } from './auth'
import type { Redemption } from './redemption'
import type { Accounting } from './accounting'
import type { GatewayKeys } from './keys'
import type { Gateway } from './gateway'
import type { ChatMessage, ChatOptions } from './provider'
import type { Faucet } from './faucet'
import { RequestError, UpstreamError } from './errors'
import { chatFormat, responsesFormat, responsesInput, responsesStream, responsesTools } from './responses'

type Services = {auth:WalletAuth; redemption:Redemption; ledger:Accounting; allowRedemption:boolean; origin:string; keys:GatewayKeys; gateway:Gateway|null; faucet:Faucet|null; redemptionAllowlist:Set<string>}
export function createApp({auth, redemption, ledger, allowRedemption, origin, keys, gateway, faucet, redemptionAllowlist}:Services) {
  let windowStart=Date.now(), attempts=0
  const socketRates=new Map<string,number>()
  const limited=()=>{if(Date.now()-windowStart>=60_000){windowStart=Date.now();attempts=0}return ++attempts>120}
  const token=(header:string|undefined)=>header?.startsWith('Bearer ') ? header.slice(7) : ''
  const account=(header:string|undefined)=>auth.account(token(header))
  const enrolled=(who:string)=>who.endsWith('.testnet') && (redemptionAllowlist.has('*') || redemptionAllowlist.has(who))
  return new Elysia({normalize:false,websocket:{maxPayloadLength:512,idleTimeout:120}}).use(cors({origin,methods:['GET','POST','DELETE'],allowedHeaders:['Content-Type','Authorization']}))
    .onError(({code,error,set,request})=>{
      const status=error instanceof RequestError ? error.status : code==='VALIDATION'||code==='PARSE' ? 400 : code==='NOT_FOUND' ? 404 : 500
      set.status=status
      const message=error instanceof RequestError ? error.message : status===400 ? 'Invalid request' : status===404 ? 'Not found' : 'Internal server error'
      return new URL(request.url).pathname.startsWith('/v1/') ? {error:{message,type:status>=500?'server_error':'invalid_request_error',code:status>=500?'internal_error':status===404?'not_found':'invalid_request'}} : {error:message}
    })
    .ws('/rooms/:id/ws',{
      params:t.Object({id:t.String({pattern:'^[0-9]{1,20}$'})}),
      body:t.Object({type:t.Literal('resync')},{additionalProperties:false}),
      beforeHandle:({headers,set})=>{if(headers.origin !== origin){set.status=403;return 'Forbidden'}},
      open(ws){ws.subscribe(`room:${ws.data.params.id}`);ws.send({type:'resync_required'});ws.publish(`room:${ws.data.params.id}`,{type:'resync_required'})},
      message(ws){const now=Date.now();if(now-(socketRates.get(ws.id) ?? 0)<2000)return;socketRates.set(ws.id,now);ws.publish(`room:${ws.data.params.id}`,{type:'resync_required'})},
      close(ws){socketRates.delete(ws.id);ws.unsubscribe(`room:${ws.data.params.id}`);ws.publish(`room:${ws.data.params.id}`,{type:'resync_required'})},
    })
    .get('/health',()=>({ok:true}))
    .get('/config',()=>({network:'testnet',redemptionAvailable:allowRedemption && gateway !== null,redemptionUnitsAvailable:allowRedemption && gateway !== null ? redemption.remainingUnits() : null,pccPerUnit:'5',provider:gateway?.providerName ?? null,model:gateway?.model ?? null,capabilities:gateway?.capabilities ?? null,contextTokens:gateway?.contextTokens ?? null,faucetAvailable:faucet !== null,microsPerUnit:gateway?.maxUnitCostMicros ?? null,maxOutputTokens:gateway?.maxOutputTokens ?? null}))
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
    .post('/v1/responses',async({headers,body,set})=>{
      const raw=token(headers.authorization)
      if(!keys.authenticate(raw)){set.status=401;return {error:{message:'Invalid API key',type:'authentication_error',code:'invalid_api_key'}}}
      if(!gateway){set.status=503;return {error:{message:'Inference is unavailable',type:'server_error',code:'unavailable'}}}
      if(new TextEncoder().encode(JSON.stringify(body)).length>256_000)throw new RequestError('Request too large',400)
      const messages=responsesInput(body.input,body.instructions)
      const options=responsesTools(body.tools,body.tool_choice,body.parallel_tool_calls)
      if(body.text!==undefined)options.response_format=responsesFormat(body.text)
      try {
        const max=body.max_output_tokens ?? gateway.maxOutputTokens
        if(body.stream) return new Response(responsesStream(gateway.stream(raw,body.model,messages,max,options),body.model),{headers:{'content-type':'text/event-stream','cache-control':'no-cache','x-accel-buffering':'no'}})
        const result=await gateway.complete(raw,body.model,messages,max,options)
        const choice=result.choices[0]
        if(!['stop','length','tool_calls'].includes(choice.finish_reason)) throw new Error('Unsupported provider result')
        const incomplete=choice.finish_reason==='length'
        const output:unknown[]=[]
        if(typeof choice.message.content==='string') output.push({id:result.id.replace('chatcmpl-','msg_'),type:'message',status:incomplete?'incomplete':'completed',role:'assistant',content:[{type:'output_text',text:choice.message.content,annotations:[]}]})
        for(const [i,entry] of (choice.message.tool_calls ?? []).entries()) {
          const call=entry as {id?:unknown;type?:unknown;function?:{name?:unknown;arguments?:unknown}}
          if(call?.type!=='function'||typeof call.id!=='string'||typeof call.function?.name!=='string'||typeof call.function.arguments!=='string') throw new Error('Unsupported provider result')
          output.push({id:`fc_${result.id.slice(9)}_${i}`,type:'function_call',status:'completed',call_id:call.id,name:call.function.name,arguments:call.function.arguments})
        }
        if(output.length===0) throw new Error('Unsupported provider result')
        return {id:result.id.replace('chatcmpl-','resp_'),object:'response',created_at:result.created,status:incomplete?'incomplete':'completed',model:result.model,output,usage:{input_tokens:result.usage.prompt_tokens,output_tokens:result.usage.completion_tokens,total_tokens:result.usage.total_tokens},error:null,incomplete_details:incomplete?{reason:'max_output_tokens'}:null}
      } catch(e) {
        const msg=e instanceof Error?e.message:'';const payment=msg==='Insufficient allowance'||msg==='Key quota exceeded or revoked';const limited=msg==='Project spending cap exceeded'||msg==='Rate limit exceeded'||msg==='Concurrency limit exceeded';const invalid=msg==='Model is not supported'||msg==='Invalid output limit'||msg==='Invalid messages'||msg==='Streaming is not supported'||msg==='Tool calling is not supported'||msg==='Images are not supported';const upstream=e instanceof UpstreamError
        set.status=payment?402:limited?429:invalid?400:upstream?502:500
        return {error:{message:payment?'Insufficient allowance or key quota':limited?'Spending or rate limit reached':invalid?msg:'Inference request could not be completed',type:payment?'insufficient_quota':limited?'rate_limit_error':invalid?'invalid_request_error':'server_error',code:payment?'insufficient_quota':limited?'rate_limit':invalid?'invalid_request':upstream?'upstream_error':'internal_error'}}
      }
    },{body:t.Object({model:t.String({minLength:1,maxLength:200}),input:t.Unknown(),text:t.Optional(t.Unknown()),instructions:t.Optional(t.String({maxLength:100000})),max_output_tokens:t.Optional(t.Integer({minimum:1,maximum:4096})),stream:t.Optional(t.Boolean()),store:t.Optional(t.Literal(false)),tools:t.Optional(t.Unknown()),tool_choice:t.Optional(t.Unknown()),parallel_tool_calls:t.Optional(t.Boolean()),reasoning:t.Optional(t.Object({effort:t.Literal('none'),summary:t.Optional(t.Union([t.Literal('auto'),t.Null()]))},{additionalProperties:false})),include:t.Optional(t.Array(t.Literal('reasoning.encrypted_content'),{maxItems:1})),prompt_cache_key:t.Optional(t.String({maxLength:256})),client_metadata:t.Optional(t.Record(t.String({maxLength:128}),t.String({maxLength:1024}),{maxProperties:32}))},{additionalProperties:false})})
    .post('/v1/chat/completions',async({headers,body,set})=>{
      const raw=token(headers.authorization)
      if(!keys.authenticate(raw)){set.status=401;return {error:{message:'Invalid API key',type:'authentication_error',code:'invalid_api_key'}}}
      if(!gateway){set.status=503;return {error:{message:'Inference is unavailable',type:'server_error',code:'unavailable'}}}
      const options:ChatOptions={...(body.tools?{tools:body.tools}:{}),...(body.tool_choice!==undefined?{tool_choice:body.tool_choice}:{}),...(body.parallel_tool_calls!==undefined?{parallel_tool_calls:body.parallel_tool_calls}:{}),...(body.temperature!==undefined?{temperature:body.temperature}:{}),...(body.response_format!==undefined?{response_format:chatFormat(body.response_format)}:{})}
      try{
        if(body.max_tokens!==undefined && body.max_completion_tokens!==undefined) throw new Error('Invalid output limit')
        const max=body.max_tokens ?? body.max_completion_tokens ?? Math.min(128,gateway.maxOutputTokens)
        const messages=body.messages as ChatMessage[]
        if(body.stream) return new Response(gateway.stream(raw,body.model,messages,max,options),{headers:{'content-type':'text/event-stream','cache-control':'no-cache','x-accel-buffering':'no'}})
        return await gateway.complete(raw,body.model,messages,max,options)
      }catch(e){
        const msg=e instanceof Error ? e.message : '';const payment=msg==='Insufficient allowance'||msg==='Key quota exceeded or revoked';const limited=msg==='Project spending cap exceeded'||msg==='Rate limit exceeded'||msg==='Concurrency limit exceeded';const invalid=msg==='Model is not supported'||msg==='Invalid output limit'||msg==='Invalid messages'||msg==='Streaming is not supported'||msg==='Tool calling is not supported'||msg==='Images are not supported'
        const upstream=e instanceof UpstreamError
        set.status=payment?402:limited?429:invalid?400:upstream?502:500
        return {error:{message:payment?'Insufficient allowance or key quota':limited?'Spending or rate limit reached':invalid?msg:'Inference request could not be completed',type:payment?'insufficient_quota':limited?'rate_limit_error':invalid?'invalid_request_error':'server_error',code:payment?'insufficient_quota':limited?'rate_limit':invalid?'invalid_request':upstream?'upstream_error':'internal_error'}}
      }
    },{body:t.Object({model:t.String({minLength:1,maxLength:200}),messages:t.Array(t.Object({role:t.String({maxLength:20}),content:t.Union([t.String({maxLength:100000}),t.Null(),t.Array(t.Union([t.Object({type:t.Literal('text'),text:t.String({maxLength:100000})},{additionalProperties:false}),t.Object({type:t.Literal('image_url'),image_url:t.Object({url:t.String({maxLength:200000}),detail:t.Optional(t.Union([t.Literal('auto'),t.Literal('low'),t.Literal('high')]))},{additionalProperties:false})},{additionalProperties:false})]),{minItems:1,maxItems:64})]),tool_calls:t.Optional(t.Array(t.Unknown(),{maxItems:32})),tool_call_id:t.Optional(t.String({maxLength:256})),name:t.Optional(t.String({maxLength:256})),reasoning_content:t.Optional(t.String({maxLength:100000}))},{additionalProperties:false}),{minItems:1,maxItems:32}),max_tokens:t.Optional(t.Integer({minimum:1,maximum:4096})),max_completion_tokens:t.Optional(t.Integer({minimum:1,maximum:4096})),stream:t.Optional(t.Boolean()),store:t.Optional(t.Literal(false)),stream_options:t.Optional(t.Object({include_usage:t.Optional(t.Boolean())},{additionalProperties:false})),tools:t.Optional(t.Array(t.Unknown(),{maxItems:128})),tool_choice:t.Optional(t.Unknown()),parallel_tool_calls:t.Optional(t.Boolean()),temperature:t.Optional(t.Number({minimum:0,maximum:2})),response_format:t.Optional(t.Unknown())},{additionalProperties:false})})
    .get('/api/inference/balance',({headers,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};return {units:ledger.balance(who)}})
    .get('/api/redemptions',({headers,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};return {intents:redemption.list(who)}})
    .post('/api/redemptions',({headers,body,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};if(!allowRedemption){set.status=503;return {error:'Redemption is unavailable'}};if(!enrolled(who)){set.status=403;return {error:'This wallet is not enrolled in the demo'}};if(limited()){set.status=429;return {error:'Try again later'}};return redemption.create(who,body.units)}, {body:t.Object({units:t.Integer({minimum:1,maximum:100})})})
    .get('/api/redemptions/:id',({headers,params,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};const intent=redemption.get(params.id,who);if(!intent){set.status=404;return {error:'Not found'}};return intent})
    .post('/api/redemptions/:id/attempt',({headers,params,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};if(!allowRedemption){set.status=503;return {error:'Redemption is unavailable'}};if(!enrolled(who)){set.status=403;return {error:'This wallet is not enrolled in the demo'}};if(limited()){set.status=429;return {error:'Try again later'}};redemption.beginTransfer(params.id,who);return {ok:true}})
    .post('/api/redemptions/:id/verify',async({headers,params,body,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};if(limited()){set.status=429;return {error:'Try again later'}};return redemption.verify(params.id,who,body.transactionHash)}, {body:t.Object({transactionHash:t.String({minLength:32,maxLength:50})})})
    .post('/api/redemptions/:id/failure',async({headers,params,body,set})=>{const who=account(headers.authorization);if(!who){set.status=401;return {error:'Unauthorized'}};if(limited()){set.status=429;return {error:'Try again later'}};return redemption.reconcileFailure(params.id,who,body.transactionHash)}, {body:t.Object({transactionHash:t.String({minLength:32,maxLength:50})})})
}
