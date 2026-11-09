import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from 'near-api-js'
import { signMessage } from 'near-api-js/nep413'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
const api=process.env.JOURNEY_API_URL || 'http://127.0.0.1:3001',account=process.env.TESTNET_PLAYER_A
if(!account?.endsWith('.testnet') || !process.env.TESTNET_PLAYER_A_KEY || !process.env.TESTNET_PLAYER_B_KEY || !process.env.TESTNET_PLAYER_B) throw new Error('Set both Testnet player accounts and credential file paths.')
if(new URL(api).hostname !== '127.0.0.1' && new URL(api).hostname !== 'localhost') throw new Error('Journey requires a local operator gateway.')
const credentials=await Bun.file(process.env.TESTNET_PLAYER_A_KEY).json()
const pair=KeyPair.fromString(credentials.private_key),rpc=new JsonRpcProvider({url:'https://archival-rpc.testnet.near.org'}),signer=new Account(account,rpc,new KeyPairSigner(pair))
async function request(path:string,method='GET',body?:unknown,token?:string){
 const response=await fetch(api+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)})
 if(!response.ok)throw new Error(`${path}: HTTP ${response.status}`)
 return response
}
const trace:Record<string,unknown>={scope:'operator-only local server; real Testnet and configured provider',account,status:'starting'}
const path=`tmp/testnet-journey-${randomUUID()}.json`
const save=async()=>await writeFile(path,`${JSON.stringify(trace,null,2)}\n`,{mode:0o600})
await mkdir('tmp',{recursive:true})
await save()
let session='',keyId=''
try{
 const config=await (await request('/config')).json() as {redemptionAvailable:boolean; capabilities?:{streaming:boolean;toolCalls:boolean}; provider:string; model:string; contextTokens:number; maxOutputTokens:number}
 if(!config.redemptionAvailable || !config.capabilities?.streaming || !config.capabilities?.toolCalls)throw new Error('A local provider with streaming and tool calls is required')
 trace.provider=config.provider;trace.model=config.model;await save()
 const executable=process.env.OPENCODE_BIN || 'opencode'
 if(!Bun.which(executable))throw new Error('OpenCode is required; set OPENCODE_BIN to its executable')
 // The match runner persists its own recovery trace and secrets before transactions.
 const match=Bun.spawn(['bun','apps/server/src/testnet-match.ts'],{env:{...process.env,TESTNET_MATCH_OUTCOME:'win'},stdout:'pipe',stderr:'pipe'})
 const [matchOutput,matchError,matchExit]=await Promise.all([new Response(match.stdout).text(),new Response(match.stderr).text(),match.exited])
 const matchTrace=matchOutput.match(/Trace: (tmp\/testnet-match-[^\s]+\.json)/)?.[1]
 if(matchExit!==0 || !matchTrace)throw new Error(`Match failed; inspect its recovery trace. ${matchError.slice(0,500)}`)
 const matchEvidence=await Bun.file(matchTrace).json()
 trace.matchId=matchEvidence.matchId;trace.matchTrace=matchTrace;trace.status='match-claimed';await save()
 const challenge=await (await request('/api/auth/challenge','POST')).json() as {id:string; message:string; recipient:string; nonce:string}
 const signed=await signMessage({signerAccount:signer,payload:{message:challenge.message,recipient:challenge.recipient,nonce:Uint8Array.from(Buffer.from(challenge.nonce,'base64'))}})
 const auth=await (await request('/api/auth/verify','POST',{challengeId:challenge.id,accountId:account,publicKey:pair.getPublicKey().toString(),signature:Buffer.from(signed.signature).toString('base64')})).json() as {token:string};session=auth.token
 const intent=await (await request('/api/redemptions','POST',{},session)).json() as {id:string;token:string;escrow:string;amount:string}
 trace.intentId=intent.id;trace.escrow=intent.escrow;trace.status='intent-created';await save()
 trace.status='deposit-attempted';await save()
 let tx:Awaited<ReturnType<typeof signer.callFunctionRaw>>
 try {
  tx=await signer.callFunctionRaw({contractId:intent.token,methodName:'ft_transfer_call',args:{receiver_id:intent.escrow,amount:intent.amount,memo:null,msg:intent.id},gas:100000000000000n,deposit:1n,waitUntil:'FINAL'})
 } catch(error) {
  const result=(error as {transactionResult?:{transaction?:{hash?:unknown};final_execution_status?:unknown}})?.transactionResult
  if(typeof result?.transaction?.hash==='string')trace.transactionHash=result.transaction.hash
  if(typeof result?.final_execution_status==='string')trace.transactionFinality=result.final_execution_status
  await save();throw error
 }
 trace.transactionHash=tx.transaction.hash;trace.status='deposit-returned';await save()
 const state=await (await request(`/api/redemptions/${intent.id}`,'GET',undefined,session)).json() as {deposit:{status:string}|null}
 if(!state.deposit)throw new Error('Escrow did not accept the deposit; reconcile the transaction before retrying')
 await request(`/api/redemptions/${intent.id}/approve`,'POST',undefined,session);trace.status='approved';await save()
 const consumption=await signer.callFunctionRaw({contractId:intent.escrow,methodName:'consume',args:{id:intent.id},gas:30000000000000n,deposit:0n,waitUntil:'FINAL'})
 trace.consumptionHash=consumption.transaction.hash;trace.status='consumed';await save()
 const first=await (await request(`/api/redemptions/${intent.id}/claim`,'POST',undefined,session)).json() as {credited:boolean}
 const replay=await (await request(`/api/redemptions/${intent.id}/claim`,'POST',undefined,session)).json() as {credited:boolean}
 if(!first.credited || replay.credited)throw new Error('Unexpected redemption replay result')
 trace.receiptId=`${intent.escrow}:${account}:${intent.id}`;trace.status='credited';trace.allowanceBefore=(await (await request('/api/inference/balance','GET',undefined,session)).json() as {units:number}).units;await save()
 const available=(await (await request('/api/inference/balance','GET',undefined,session)).json() as {units:number}).units
 if(!Number.isSafeInteger(available)||available<1)throw new Error('No gateway allowance remains')
 const key=await (await request('/api/keys','POST',{quota:Math.min(available,1000000000)},session)).json() as {id:string; key:string};keyId=key.id
 const response=await request('/v1/chat/completions','POST',{model:config.model,messages:[{role:'user',content:'Use the read_file tool to read notes.txt.'}],max_tokens:100,stream:true,tools:[{type:'function',function:{name:'read_file',description:'Read a file',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}}],tool_choice:'required',temperature:0},key.key)
 const text=await response.text();if(!text.includes('tool_calls')||!text.includes('[DONE]'))throw new Error('Expected a completed streaming tool call')
 trace.allowanceAfter=(await (await request('/api/inference/balance','GET',undefined,session)).json() as {units:number}).units
 trace.usage=(await (await request('/api/inference/usage','GET',undefined,session)).json() as {requests:unknown[]}).requests
 const directory=await mkdtemp(join(tmpdir(),'promptplay-journey-'))
 try {
  await writeFile(join(directory,'marker.txt'),'PROMPTPLAY_JOURNEY_OK\n')
  const clientConfig=JSON.stringify({provider:{promptplay:{npm:'@ai-sdk/openai-compatible',name:'PromptPlay',options:{baseURL:`${api}/v1`,apiKey:'{env:PROMPTPLAY_API_KEY}'},models:{[config.model]:{name:config.model,limit:{context:config.contextTokens,output:config.maxOutputTokens},tool_call:true}}}}})
  const env={...process.env,INFERENCE_API_KEY:'',OPENCODE_CONFIG_CONTENT:clientConfig,PROMPTPLAY_API_KEY:key.key,OPENCODE_DISABLE_MODELS_FETCH:'true',XDG_CONFIG_HOME:join(directory,'config'),XDG_DATA_HOME:join(directory,'data'),XDG_STATE_HOME:join(directory,'state'),XDG_CACHE_HOME:join(directory,'cache')}
  const client=Bun.spawn([executable,'run','--pure','--auto','--format','json','--dir',directory,'-m',`promptplay/${config.model}`,'Read marker.txt using your file tool and reply with its exact content.'],{cwd:directory,env,stdout:'pipe',stderr:'pipe'})
  const timeout=setTimeout(()=>client.kill(),120000)
  const [output,,exit]=await Promise.all([new Response(client.stdout).text(),new Response(client.stderr).text(),client.exited]);clearTimeout(timeout)
  if(exit!==0 || !output.includes('PROMPTPLAY_JOURNEY_OK') || !/tool_use|tool-use|"tool":"read"/i.test(output))throw new Error('OpenCode file-read check failed')
  trace.client='OpenCode';trace.clientFileRead=true
 } finally {await rm(directory,{recursive:true,force:true})}
 trace.allowanceAfterClient=(await (await request('/api/inference/balance','GET',undefined,session)).json() as {units:number}).units
 if(typeof trace.allowanceAfterClient!=='number' || typeof trace.allowanceAfter!=='number' || trace.allowanceAfterClient>=trace.allowanceAfter)throw new Error('OpenCode usage did not settle against the allowance')
 trace.status='passed';await save()
 console.log(JSON.stringify({status:trace.status,account,matchId:trace.matchId,transactionHash:trace.transactionHash,receiptId:trace.receiptId,allowanceBefore:trace.allowanceBefore,allowanceAfterClient:trace.allowanceAfterClient,replayCredited:replay.credited,client:trace.client,trace:path}))
}catch(error){trace.status='needs-reconciliation';trace.error=error instanceof Error?error.message:String(error);await save();console.error('Inspect trace before retrying:',path);throw error}
finally{if(keyId && session)await request(`/api/keys/${keyId}`,'DELETE',undefined,session).catch(()=>{});if(session)await request('/api/auth/session','DELETE',undefined,session).catch(()=>{})}
