import {Database} from 'bun:sqlite'
import {Accounting} from './accounting'
import {GatewayKeys} from './keys'
import {Gateway} from './gateway'
import {createProvider,verifyProviderModel} from './provider'
const providerConfig={liveEnabled:true,endpoint:'http://127.0.0.1:11434/v1',model:'llama3:latest',apiKey:'ollama'}
await verifyProviderModel(providerConfig)
const db=new Database(':memory:'),ledger=new Accounting(db,1_000_000),keys=new GatewayKeys(db)
ledger.creditReceipt('synthetic','test','operator.testnet',1_000_000)
const key=keys.create('operator.testnet',1_000_000),p=createProvider(providerConfig)
const gateway=new Gateway(ledger,keys,p,providerConfig.model,{inputMicrosPerMillion:1,outputMicrosPerMillion:1,microsPerUnit:1000000,contextTokens:8192,maxOutputTokens:512},'Ollama',{streaming:true,toolCalls:false})
const before=ledger.balance('operator.testnet')
const r=await gateway.complete(key.key,providerConfig.model,[{role:'user',content:'Say hello in one word. /no_think'}],128)
if (!r.choices[0]?.message.content || ledger.balance('operator.testnet')>=before)throw new Error('Local response or metering missing')
console.log(JSON.stringify({model:providerConfig.model,syntheticAllowance:true,nonStreaming:true,usage:r.usage}))
const stream=await new Response(gateway.stream(key.key,providerConfig.model,[{role:'user',content:'Say hello in one word. /no_think'}],128)).text()
if(!stream.includes('data: [DONE]'))throw new Error('Stream did not settle')
console.log(JSON.stringify({streaming:true,remaining:ledger.balance('operator.testnet')}))
const toolConfig={...providerConfig,model:'qwen3:4b'}
await verifyProviderModel(toolConfig)
const toolGateway=new Gateway(ledger,keys,createProvider(toolConfig),toolConfig.model,{inputMicrosPerMillion:1,outputMicrosPerMillion:1,microsPerUnit:1000000,contextTokens:32768,maxOutputTokens:512},'Ollama',{streaming:true,toolCalls:true})
const tools=[{type:'function',function:{name:'read_file',description:'Read a file',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}}]
const toolResponse=await toolGateway.complete(key.key,toolConfig.model,[{role:'user',content:'Use the read_file tool to open notes.txt. /no_think'}],512,{tools,tool_choice:'required',temperature:0})
if(!toolResponse.choices[0]?.message.tool_calls?.length) throw new Error('Local model did not return a tool call')
console.log(JSON.stringify({model:toolConfig.model,syntheticAllowance:true,toolCalls:true,usage:toolResponse.usage}))
const toolStream=await new Response(toolGateway.stream(key.key,toolConfig.model,[{role:'user',content:'Use the read_file tool to open notes.txt. /no_think'}],512,{tools,tool_choice:'required',temperature:0})).text()
if(!toolStream.includes('tool_calls') || !toolStream.includes('data: [DONE]')) throw new Error('Local model did not stream a complete tool call')
console.log(JSON.stringify({model:toolConfig.model,streamedToolCalls:true,remaining:ledger.balance('operator.testnet')}))
