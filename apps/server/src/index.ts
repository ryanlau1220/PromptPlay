import { Database } from 'bun:sqlite'
import { JsonRpcProvider } from 'near-api-js'
import { Accounting } from './accounting'
import { WalletAuth } from './auth'
import { Redemption } from './redemption'
import { createApp } from './app'

const cap=Number(process.env.INFERENCE_SPENDING_CAP_UNITS ?? '1000')
const db=new Database(process.env.DATABASE_PATH ?? 'promptplay.sqlite', {create:true})
const rpc=new JsonRpcProvider({url:process.env.NEAR_RPC_URL ?? 'https://test.rpc.fastnear.com'})
if (await rpc.getNetworkId() !== 'testnet') throw new Error('Configured RPC is not NEAR Testnet')
const ledger=new Accounting(db,cap)
const auth=new WalletAuth(db,rpc)
const redemption=new Redemption(db,ledger,rpc)
const app=createApp({auth,redemption,ledger,allowRedemption:false,origin:process.env.APP_ORIGIN ?? 'http://localhost:3000'})
app.listen({hostname:'127.0.0.1',port:Number(process.env.PORT ?? '3001')})
console.log(`PromptPlay server listening on ${app.server?.port}`)
