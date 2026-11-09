import { randomUUID } from 'node:crypto'
import type { Accounting } from './accounting'
import type { GatewayKeys } from './keys'
import type { ChatMessage, ChatOptions, InferenceProvider, ProviderCapabilities, StreamEvent } from './provider'
import { UpstreamError } from './errors'

export type Pricing = { inputMicrosPerMillion:number; outputMicrosPerMillion:number; microsPerUnit:number; contextTokens:number; maxOutputTokens:number }
function ceil(n:bigint,d:bigint) { return (n+d-1n)/d }
function positive(n:number) { return Number.isSafeInteger(n) && n > 0 }
export class Gateway {
  constructor(private ledger:Accounting, private keys:GatewayKeys, private provider:InferenceProvider, readonly model:string, private pricing:Pricing, readonly providerName='OpenAI-compatible', readonly capabilities:ProviderCapabilities={streaming:false,toolCalls:false}) {
    if (!model || !Object.values(pricing).every(positive) || pricing.maxOutputTokens > pricing.contextTokens) throw new Error('Invalid gateway pricing or token limits')
    if(!providerName || providerName.length>80 || (capabilities.streaming && !provider.stream)) throw new Error('Invalid provider capabilities')
    if (this.cost(pricing.contextTokens,Math.min(128,pricing.maxOutputTokens)) > 1_000_000) throw new Error('One demo unit cannot cover the request reservation')
  }
  get maxUnitCostMicros() { return this.pricing.microsPerUnit }
  get maxOutputTokens() { return this.pricing.maxOutputTokens }
  get contextTokens() { return this.pricing.contextTokens }
  private cost(input:number,output:number) {
    const p=this.pricing
    const micros=ceil(BigInt(input)*BigInt(p.inputMicrosPerMillion),1_000_000n)+ceil(BigInt(output)*BigInt(p.outputMicrosPerMillion),1_000_000n)
    const units=ceil(micros*1_000_000n,BigInt(p.microsPerUnit))
    if(units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Request cost is too large')
    return Number(units)
  }
  private reserve(rawKey:string, model:string, messages:ChatMessage[], maxTokens:number, options?:ChatOptions) {
    const key=this.keys.authenticate(rawKey); if (!key) throw new Error('Invalid API key')
    if(model!==this.model) throw new Error('Model is not supported')
    if(!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>this.pricing.maxOutputTokens) throw new Error('Invalid output limit')
    if(!Array.isArray(messages)||messages.length<1||messages.length>32||messages.some(m=>!m||!['system','developer','user','assistant','tool'].includes(m.role)||(typeof m.content!=='string' && !(Array.isArray(m.content) && m.content.length>0 && m.content.length<=64 && m.content.every(part=>part && part.type==='text' && typeof part.text==='string')) && !(m.role==='assistant' && m.content===null && Array.isArray(m.tool_calls)))||(m.role==='tool' && typeof m.tool_call_id!=='string')||(m.reasoning_content!==undefined && (m.role!=='assistant'||typeof m.reasoning_content!=='string'))) || new TextEncoder().encode(JSON.stringify({messages,...options})).length>256_000) throw new Error('Invalid messages')
    if(options?.tools && (!Array.isArray(options.tools)||options.tools.length>128)) throw new Error('Invalid messages')
    if(!this.capabilities.toolCalls && (options?.tools?.length || options?.tool_choice!==undefined || options?.parallel_tool_calls!==undefined || messages.some(m=>m.role==='tool' || m.tool_calls!==undefined || m.tool_call_id!==undefined))) throw new Error('Tool calling is not supported')
    const now=Date.now()
    const requestId=randomUUID(); this.ledger.reserve(requestId,key.account_id,this.cost(this.pricing.contextTokens,maxTokens),key.id,now)
    let released=false
    const release=()=>{
      if(released)return
      released=true;this.ledger.endActivity(requestId)
    }
    return {requestId,now,release}
  }
  private settle(requestId:string,inputTokens:number,outputTokens:number,maxTokens:number) {
    if(!Number.isSafeInteger(inputTokens)||!Number.isSafeInteger(outputTokens)||inputTokens<0||outputTokens<0||outputTokens>maxTokens||inputTokens+outputTokens>this.pricing.contextTokens) throw new Error('Provider usage exceeds configured limits')
    this.ledger.settle(requestId,this.cost(inputTokens,outputTokens),{inputTokens,outputTokens})
  }
  async complete(rawKey:string, model:string, messages:ChatMessage[], maxTokens:number, options?:ChatOptions) {
    const {requestId,now,release}=this.reserve(rawKey,model,messages,maxTokens,options)
    try {
      let response: Awaited<ReturnType<InferenceProvider['complete']>>
      try { response=await this.provider.complete(messages,maxTokens,options) } catch { throw new UpstreamError('Provider request failed') }
      this.settle(requestId,response.inputTokens,response.outputTokens,maxTokens)
      return {id:`chatcmpl-${requestId}`,object:'chat.completion',created:Math.floor(now/1000),model:this.model,choices:[{index:0,message:{role:'assistant',content:response.text,...(response.toolCalls?{tool_calls:response.toolCalls}:{}),...(response.reasoningContent!==undefined?{reasoning_content:response.reasoningContent}:{})},finish_reason:response.finishReason}],usage:{prompt_tokens:response.inputTokens,completion_tokens:response.outputTokens,total_tokens:response.inputTokens+response.outputTokens}}
    } finally { release() }
  }
  stream(rawKey:string,model:string,messages:ChatMessage[],maxTokens:number,options?:ChatOptions) {
    if(!this.capabilities.streaming || !this.provider.stream) throw new Error('Streaming is not supported')
    const {requestId,release}=this.reserve(rawKey,model,messages,maxTokens,options)
    let iterator:AsyncGenerator<StreamEvent>
    try { iterator=this.provider.stream(messages,maxTokens,options) } catch(error) { release(); throw error }
    const encoder=new TextEncoder()
    let counts:{inputTokens:number;outputTokens:number}|undefined
    const settle=this.settle.bind(this)
    return new ReadableStream<Uint8Array>({
      async pull(controller){try{
        while(true){
          const result=await iterator.next()
          if(result.done){if(!counts) throw new Error('Provider stream lacks usage');settle(requestId,counts.inputTokens,counts.outputTokens,maxTokens);controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();release();return}
          if(result.value.usage){if(counts) throw new Error('Duplicate provider usage');counts=result.value.usage}
          if(result.value.data!==undefined){controller.enqueue(encoder.encode(`data: ${result.value.data}\n\n`));return}
        }
      }catch(error){
        const detail=error instanceof Error && (/^Provider returned HTTP \d{3}$/.test(error.message) || ['Provider stream unavailable','Provider stream frame too large','Provider stream ended unexpectedly','Provider stream lacks usage','Invalid provider usage','Duplicate provider usage','Provider usage exceeds configured limits','Usage exceeds reservation'].includes(error.message)) ? error.message : 'Unexpected provider stream error'
        const category=error instanceof Error && ['AbortError','TimeoutError','SyntaxError','TypeError'].includes(error.name) ? error.name : 'Error'
        console.error(`Inference stream failed: ${detail} (${category})`)
        await iterator.return(undefined).catch(()=>{});release();controller.error(new Error('Inference stream could not be completed'))}},
      async cancel(){try{await iterator.return(undefined).catch(()=>{})}finally{release()}}
    })
  }
}
