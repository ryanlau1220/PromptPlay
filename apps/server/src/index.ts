import { Database } from 'bun:sqlite'
import { Account, JsonRpcProvider, KeyPairSigner, type KeyPairString } from 'near-api-js'
import { Accounting } from './accounting'
import { WalletAuth } from './auth'
import { Redemption } from './redemption'
import { createApp } from './app'
import { GatewayKeys } from './keys'
import { Gateway } from './gateway'
import { createProvider, providerConfig, verifyProviderModel } from './provider'
import { Faucet } from './faucet'
import { freezeEconomy } from './economy'

const cap=Number(process.env.INFERENCE_CAP_MICROUNITS ?? '1000000')
const db=new Database(process.env.DATABASE_PATH ?? 'promptplay.sqlite', {create:true})
const rpc=new JsonRpcProvider({url:process.env.NEAR_RPC_URL ?? 'https://test.rpc.fastnear.com'})
if (await rpc.getNetworkId() !== 'testnet') throw new Error('Configured RPC is not NEAR Testnet')
const ledger=new Accounting(db,cap)
const auth=new WalletAuth(db,rpc)
const redemption=new Redemption(db,ledger,rpc)
const keys=new GatewayKeys(db)
const live=process.env.PROMPTPLAY_LIVE_INFERENCE==='true' && process.env.PROMPTPLAY_PROVIDER_AUTHORIZED==='true' && process.env.PROMPTPLAY_PROVIDER_FUNDED==='true'
const config=providerConfig(process.env)
const redemptionAllowlist=new Set((process.env.REDEMPTION_ALLOWLIST ?? '').split(',').map(s=>s.trim()).filter(Boolean))
const pricing={inputMicrosPerMillion:Number(process.env.INPUT_MICROS_PER_MILLION),outputMicrosPerMillion:Number(process.env.OUTPUT_MICROS_PER_MILLION),microsPerUnit:Number(process.env.MICROS_PER_UNIT),contextTokens:Number(process.env.MAX_CONTEXT_TOKENS),maxOutputTokens:Number(process.env.MAX_OUTPUT_TOKENS)}
let gateway:Gateway|null=null
if(live) {
  try {
    if(redemptionAllowlist.size===0 || [...redemptionAllowlist].some(id=>id!=='*' && !id.endsWith('.testnet'))) throw new Error('A Testnet redemption allowlist is required')
    await verifyProviderModel(config)
    const candidate=new Gateway(ledger,keys,createProvider(config),config.model,pricing,config.name,config.capabilities)
    freezeEconomy(db,{model:config.model,endpoint:config.endpoint,cap,...pricing})
    gateway=candidate
  } catch { console.error('Live inference remains disabled: provider or economy validation failed.') }
}
let faucet:Faucet|null=null
if(process.env.PROMPTPLAY_FAUCET_ENABLED==='true') {
  if(!process.env.FAUCET_KEY_PATH) throw new Error('FAUCET_KEY_PATH is required')
  const credentials=await Bun.file(process.env.FAUCET_KEY_PATH).json() as {private_key:string}
  if(!credentials.private_key) throw new Error('Expected the dedicated faucet account key')
  const key=KeyPairSigner.fromSecretKey(credentials.private_key as KeyPairString)
  const access=await rpc.viewAccessKey({accountId:'faucet.ryanlau1220.testnet',publicKey:await key.getPublicKey()})
  if(access.permission!=='FullAccess') throw new Error('Faucet key does not have full access')
  const signer=new Account('faucet.ryanlau1220.testnet',rpc,key)
  faucet=new Faucet(db,rpc,async(account,amount)=>{
    const result=await signer.callFunctionRaw({contractId:'token.ryanlau1220.testnet',methodName:'ft_transfer',args:{receiver_id:account,amount,memo:'PromptPlay testnet faucet'},gas:30000000000000n,deposit:1n,waitUntil:'FINAL'})
    if(!result.status || typeof result.status !== 'object' || !('SuccessValue' in result.status) || result.final_execution_status!=='FINAL') throw new Error('Faucet transfer was not confirmed')
    return result.transaction.hash
  })
}
const app=createApp({auth,redemption,ledger,keys,gateway,faucet,redemptionAllowlist,allowRedemption:gateway !== null,origin:process.env.APP_ORIGIN ?? 'http://localhost:3000'})
app.listen({hostname:process.env.HOST ?? '127.0.0.1',port:Number(process.env.PORT ?? '3001')})
console.log(`PromptPlay server listening on ${app.server?.port}`)
