import { Database } from 'bun:sqlite'
import { JsonRpcProvider } from 'near-api-js'
import { Accounting } from './accounting'
import { WalletAuth } from './auth'
import { Redemption } from './redemption'
import { createApp } from './app'
import { GatewayKeys } from './keys'
import { Gateway } from './gateway'
import { createProvider, providerConfig } from './provider'

const cap=Number(process.env.INFERENCE_SPENDING_CAP_UNITS ?? '1000000')
const db=new Database(process.env.DATABASE_PATH ?? 'promptplay.sqlite', {create:true})
const rpc=new JsonRpcProvider({url:process.env.NEAR_RPC_URL ?? 'https://test.rpc.fastnear.com'})
if (await rpc.getNetworkId() !== 'testnet') throw new Error('Configured RPC is not NEAR Testnet')
const ledger=new Accounting(db,cap)
const auth=new WalletAuth(db,rpc)
const redemption=new Redemption(db,ledger,rpc)
const keys=new GatewayKeys(db)
const live=process.env.PROMPTPLAY_LIVE_INFERENCE==='true' && process.env.PROMPTPLAY_PROVIDER_AUTHORIZED==='true' && process.env.PROMPTPLAY_PROVIDER_FUNDED==='true'
const config=providerConfig(process.env)
const gateway=live ? new Gateway(ledger,keys,createProvider(config),config.model,{inputMicrosPerMillion:Number(process.env.INPUT_MICROS_PER_MILLION),outputMicrosPerMillion:Number(process.env.OUTPUT_MICROS_PER_MILLION),microsPerUnit:Number(process.env.MICROS_PER_UNIT),contextTokens:Number(process.env.MAX_CONTEXT_TOKENS),maxOutputTokens:Number(process.env.MAX_OUTPUT_TOKENS)}) : null
const app=createApp({auth,redemption,ledger,keys,gateway,allowRedemption:live,origin:process.env.APP_ORIGIN ?? 'http://localhost:3000'})
app.listen({hostname:'127.0.0.1',port:Number(process.env.PORT ?? '3001')})
console.log(`PromptPlay server listening on ${app.server?.port}`)
