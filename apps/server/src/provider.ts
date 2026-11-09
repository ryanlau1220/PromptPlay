export type ChatMessage = { role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'; content: string | null | Array<{type:'text';text:string}>; tool_calls?: unknown; tool_call_id?: string; name?: string; reasoning_content?: string }
export type ChatOptions = { tools?: unknown[]; tool_choice?: unknown; parallel_tool_calls?: boolean; temperature?: number }
export type Completion = { text: string | null; toolCalls?: unknown[]; reasoningContent?: string; inputTokens: number; outputTokens: number; finishReason: string }
export type StreamEvent = { data?: string; usage?: { inputTokens:number; outputTokens:number } }
export type ProviderCapabilities = { streaming:boolean; toolCalls:boolean }
export interface InferenceProvider { complete(messages: ChatMessage[], maxTokens: number, options?:ChatOptions): Promise<Completion>; stream?(messages:ChatMessage[], maxTokens:number, options?:ChatOptions): AsyncGenerator<StreamEvent> }

export function providerConfig(env: Record<string, string | undefined>) {
  return {liveEnabled:env.PROMPTPLAY_LIVE_INFERENCE === 'true',endpoint:env.INFERENCE_BASE_URL ?? 'https://cloud-api.near.ai/v1',model:env.INFERENCE_MODEL ?? 'zai-org/GLM-5.1-FP8',apiKey:env.INFERENCE_API_KEY ?? '',name:env.INFERENCE_PROVIDER_NAME?.trim() || 'OpenAI-compatible',capabilities:{streaming:env.INFERENCE_SUPPORTS_STREAMING === 'true',toolCalls:env.INFERENCE_SUPPORTS_TOOL_CALLS === 'true'}}
}
function usage(value:unknown) {
  if(!value || typeof value!=='object') return null
  const u=value as {prompt_tokens?:unknown;completion_tokens?:unknown}
  if(!Number.isSafeInteger(u.prompt_tokens)||!Number.isSafeInteger(u.completion_tokens)||(u.prompt_tokens as number)<0||(u.completion_tokens as number)<0) return null
  return {inputTokens:u.prompt_tokens as number,outputTokens:u.completion_tokens as number}
}
/** Live requests are disabled unless the operator explicitly enables an authorized deployment. */
export function createProvider(config:{liveEnabled:boolean;endpoint:string;model:string;apiKey:string}):InferenceProvider {
  if(!config.liveEnabled) throw new Error('Live inference is disabled')
  const base=new URL(config.endpoint)
  if(base.username||base.password||base.search||base.hash) throw new Error('Invalid provider URL')
  if(base.protocol!=='https:' && base.hostname!=='localhost' && base.hostname!=='127.0.0.1') throw new Error('Provider must use HTTPS or localhost')
  if(!config.apiKey||!config.model) throw new Error('Provider credentials and model are required')
  async function request(messages:ChatMessage[],maxTokens:number,options:ChatOptions|undefined,stream:boolean) {
    const res=await fetch(`${config.endpoint.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${config.apiKey}`},body:JSON.stringify({model:config.model,messages,max_tokens:maxTokens,...options,stream,...(stream?{stream_options:{include_usage:true}}:{})}),signal:AbortSignal.timeout(120_000),redirect:'error'})
    if(!res.ok) throw new Error(`Provider returned HTTP ${res.status}`)
    return res
  }
  return {
    async complete(messages,maxTokens,options) {
      const res=await request(messages,maxTokens,options,false)
      const data=await res.json() as {choices?:Array<{message?:{content?:unknown;tool_calls?:unknown;reasoning_content?:unknown};finish_reason?:unknown}>;usage?:unknown}
      const choice=data.choices?.[0],text=choice?.message?.content,toolCalls=choice?.message?.tool_calls,reasoningContent=choice?.message?.reasoning_content,counts=usage(data.usage)
      if((typeof text!=='string' && text!==null)|| (toolCalls!==undefined && !Array.isArray(toolCalls)) || (reasoningContent!==undefined && reasoningContent!==null && typeof reasoningContent!=='string') || (text===null && !Array.isArray(toolCalls)) || typeof choice?.finish_reason!=='string'||!counts) throw new Error('Provider response lacks valid message or usage')
      return {text, ...(toolCalls?{toolCalls:toolCalls as unknown[]}:{}),...(typeof reasoningContent==='string'?{reasoningContent}:{}),...counts,finishReason:choice.finish_reason}
    },
    async *stream(messages,maxTokens,options) {
      const response=await request(messages,maxTokens,options,true)
      if(!response.body) throw new Error('Provider stream unavailable')
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',done=false,finished=false
      let finalUsage:{inputTokens:number;outputTokens:number}|null=null
      try {
        while(true){
          const part=await reader.read();buffer=(buffer+decoder.decode(part.value,{stream:!part.done})).replace(/\r\n/g,'\n')
          if(buffer.length>1_000_000) throw new Error('Provider stream frame too large')
          let end=buffer.indexOf('\n\n')
          while(end>=0){
            const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);end=buffer.indexOf('\n\n')
            const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n')
            if(!data) continue
            if(data==='[DONE]'){done=true;break}
            const parsed=JSON.parse(data) as {usage?:unknown;choices?:unknown}
            const counts=parsed.usage == null ? undefined : usage(parsed.usage)
            if(parsed.usage != null && !counts) throw new Error('Invalid provider usage')
            const choices=Array.isArray(parsed.choices) ? parsed.choices as Array<{finish_reason?:unknown;delta?:unknown}> : null
            if(finalUsage && choices?.some(choice=>choice?.delta && typeof choice.delta==='object' && Object.values(choice.delta).some(value=>value!==null && value!==undefined && value!==''))) finalUsage=null
            if(choices?.some(choice=>choice && typeof choice.finish_reason==='string')) finished=true
            if(counts && choices && (choices.length===0 || ((finished || finalUsage!==null) && choices.every(choice=>choice?.delta && typeof choice.delta==='object' && !Array.isArray(choice.delta) && Object.keys(choice.delta).length===0)))) finalUsage=counts
            yield {data}
          }
          if(done || part.done) break
        }
        if(!done) throw new Error('Provider stream ended unexpectedly')
        if(finalUsage) yield {usage:finalUsage}
      } finally { await reader.cancel().catch(()=>{});reader.releaseLock() }
    }
  }
}
/** Deterministic offline test double; never exposed as a real inference provider. */
export function mockProvider():InferenceProvider { return {async complete(){return {text:'Mock response',inputTokens:2,outputTokens:2,finishReason:'stop'}}} }
export async function verifyProviderModel(config:{liveEnabled:boolean;endpoint:string;model:string;apiKey:string}):Promise<void> {
  createProvider(config)
  const response=await fetch(`${config.endpoint.replace(/\/$/,'')}/models`,{headers:{authorization:`Bearer ${config.apiKey}`},signal:AbortSignal.timeout(15_000),redirect:'error'})
  if(!response.ok) throw new Error('Provider model list is unavailable')
  const data=await response.json() as {data?:Array<{id?:unknown}>}
  if(!Array.isArray(data.data)||!data.data.some(model=>model.id===config.model)) throw new Error('Configured model is unavailable')
}
