import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { Account, actions, JsonRpcProvider, KeyPair, KeyPairSigner, type KeyPairString } from 'near-api-js'

// Run once. Preserve the trace and key if any transaction has an uncertain outcome.
const owner='ryanlau1220.testnet', contract='redeem.ryanlau1220.testnet', token='token.ryanlau1220.testnet', treasury='treasury.ryanlau1220.testnet'
const cap=process.env.ESCROW_DEPLOY_CAP, keyPath=process.env.ESCROW_DEPLOY_OWNER_KEY
if(!cap || !/^[1-9][0-9]*$/.test(cap) || !keyPath)throw new Error('Set ESCROW_DEPLOY_CAP and ESCROW_DEPLOY_OWNER_KEY')
const rpc=new JsonRpcProvider({url:process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com'})
if(await rpc.getNetworkId()!=='testnet')throw new Error('RPC is not Testnet')
try{await rpc.viewAccount({accountId:contract});throw new Error('Escrow account already exists; reconcile before retrying')}catch(e){if(!(e instanceof Error)||e.constructor.name!=='AccountDoesNotExistError')throw e}
const credentials=await Bun.file(keyPath).json() as {private_key:KeyPairString}
const full=KeyPairSigner.fromSecretKey(credentials.private_key),account=new Account(owner,rpc,full)
const restricted=KeyPair.fromRandom('ed25519')
const restrictedPath='apps/server/.env.escrow-key.json',tracePath='tmp/redemption-deployment.json'
await writeFile(restrictedPath,JSON.stringify({account_id:owner,public_key:restricted.getPublicKey().toString(),private_key:restricted.toString()}),{mode:0o600,flag:'wx'})
const wasm=new Uint8Array(await Bun.file('contracts/redemption-escrow/target/near/redemption_escrow.wasm').arrayBuffer())
const trace:Record<string,unknown>={network:'testnet',owner,contract,token,treasury,cap,sha256:createHash('sha256').update(wasm).digest('hex'),status:'prepared'}
const save=()=>writeFile(tracePath,JSON.stringify(trace,null,2),{mode:0o600})
await save()
const confirmed=(r:Awaited<ReturnType<typeof account.signAndSendTransaction>>)=>{if(r.final_execution_status!=='FINAL'||!r.status||typeof r.status!=='object'||!('SuccessValue' in r.status))throw new Error('Transaction did not finalize successfully');return r.transaction.hash}
try{
 trace.status='creating';await save()
 const deployment=await account.signAndSendTransaction({receiverId:contract,actions:[actions.createAccount(),actions.transfer(5_000_000_000_000_000_000_000_000n),actions.addFullAccessKey(await full.getPublicKey()),actions.deployContract(wasm),actions.functionCall('new',{token,owner,treasury,cap},30_000_000_000_000n,0n)],waitUntil:'FINAL'})
 trace.deploymentTransaction=confirmed(deployment);trace.status='deployed';await save()
 const registration=await account.callFunctionRaw({contractId:token,methodName:'storage_deposit',args:{account_id:contract,registration_only:true},gas:30_000_000_000_000n,deposit:2_000_000_000_000_000_000_000n,waitUntil:'FINAL'})
 trace.registrationTransaction=confirmed(registration);trace.status='registered';await save()
 const addKey=await account.signAndSendTransaction({receiverId:owner,actions:[actions.addFunctionCallAccessKey(restricted.getPublicKey(),contract,['approve'],1_000_000_000_000_000_000_000_000n)],waitUntil:'FINAL'})
 trace.keyTransaction=confirmed(addKey);trace.status='key-added';await save()
 const code=await rpc.viewAccount({accountId:contract,blockQuery:{finality:'final'}})
 const settings=await rpc.callFunction({contractId:contract,method:'settings',args:{},blockQuery:{blockId:code.block_hash}})
 if(JSON.stringify(settings)!==JSON.stringify({token,owner,treasury,cap,allocated:'0'}))throw new Error('Escrow settings mismatch')
 trace.codeHash=code.code_hash;trace.status='verified';await save();console.log(JSON.stringify(trace))
}catch(error){trace.status='needs-reconciliation';await save();console.error(`Inspect ${tracePath} and chain state before retrying.`);throw error}
