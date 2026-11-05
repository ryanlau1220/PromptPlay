import { randomUUID } from 'node:crypto'
import type { Accounting } from './accounting'
import type { GatewayKeys } from './keys'
import type { ChatMessage, InferenceProvider } from './provider'

export type Pricing = { inputMicrosPerMillion:number; outputMicrosPerMillion:number; microsPerUnit:number; contextTokens:number; maxOutputTokens:number }
function ceil(n:bigint,d:bigint) { return (n+d-1n)/d }
function positive(n:number) { return Number.isSafeInteger(n) && n > 0 }
export class Gateway {
  private rates=new Map<string,{start:number;count:number}>()
  constructor(private ledger:Accounting, private keys:GatewayKeys, private provider:InferenceProvider, readonly model:string, private pricing:Pricing) {
    if (!model || !Object.values(pricing).every(positive) || pricing.maxOutputTokens > pricing.contextTokens) throw new Error('Invalid gateway pricing or token limits')
  }
  private cost(input:number,output:number) {
    const p=this.pricing
    const micros=ceil(BigInt(input)*BigInt(p.inputMicrosPerMillion),1_000_000n)+ceil(BigInt(output)*BigInt(p.outputMicrosPerMillion),1_000_000n)
    const units=ceil(micros*1_000_000n,BigInt(p.microsPerUnit))
    if(units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Request cost is too large')
    return Number(units)
  }
  async complete(rawKey:string, model:string, messages:ChatMessage[], maxTokens:number) {
    const key=this.keys.authenticate(rawKey); if (!key) throw new Error('Invalid API key')
    if(model!==this.model) throw new Error('Model is not supported')
    if(!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>this.pricing.maxOutputTokens) throw new Error('Invalid output limit')
    if(!Array.isArray(messages)||messages.length<1||messages.length>32||messages.some(m=>!m||!['system','user','assistant'].includes(m.role)||typeof m.content!=='string') || new TextEncoder().encode(JSON.stringify(messages)).length>20000) throw new Error('Invalid messages')
    const now=Date.now(); const rate=this.rates.get(key.id)
    if(rate && now-rate.start<60_000){if(rate.count>=10) throw new Error('Rate limit exceeded');rate.count++} else this.rates.set(key.id,{start:now,count:1})
    const requestId=randomUUID(); const reserved=this.cost(this.pricing.contextTokens,maxTokens)
    this.ledger.reserve(requestId,key.account_id,reserved,key.id)
    // On timeout, invalid provider usage, or unknown execution the reservation stays in place.
    const response=await this.provider.complete(messages,maxTokens)
    if(!Number.isSafeInteger(response.inputTokens)||!Number.isSafeInteger(response.outputTokens)||response.inputTokens<0||response.outputTokens<0||response.outputTokens>maxTokens||response.inputTokens+response.outputTokens>this.pricing.contextTokens) throw new Error('Provider usage exceeds configured limits')
    const used=this.cost(response.inputTokens,response.outputTokens)
    this.ledger.settle(requestId,used,{inputTokens:response.inputTokens,outputTokens:response.outputTokens})
    return {id:`chatcmpl-${requestId}`,object:'chat.completion',created:Math.floor(now/1000),model:this.model,choices:[{index:0,message:{role:'assistant',content:response.text},finish_reason:response.finishReason}],usage:{prompt_tokens:response.inputTokens,completion_tokens:response.outputTokens,total_tokens:response.inputTokens+response.outputTokens}}
  }
}
