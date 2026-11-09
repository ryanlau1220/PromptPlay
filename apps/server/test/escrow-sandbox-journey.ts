import { Database } from 'bun:sqlite'
import { strict as assert } from 'node:assert'
import { Account, JsonRpcProvider, KeyPairSigner, type KeyPairString } from 'near-api-js'
import { Accounting } from '../src/accounting'
import { EscrowRedemption, nearEscrowChain } from '../src/escrow-redemption'

const url=process.env.SANDBOX_RPC, ownerKey=process.env.SANDBOX_OWNER_KEY, playerKey=process.env.SANDBOX_PLAYER_KEY
if(!url || !ownerKey || !playerKey || new URL(url).hostname!=='127.0.0.1')throw new Error('A local sandbox and sandbox keys are required')
const realRpc=new JsonRpcProvider({url})
// The production adapter requires Testnet; only this isolated sandbox test substitutes its network label.
const rpc=new Proxy(realRpc,{get(target,key){if(key==='getNetworkId')return async()=> 'testnet';const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}})
const owner=new Account('owner.testnet',rpc,KeyPairSigner.fromSecretKey(ownerKey as KeyPairString))
const player=new Account('player.testnet',rpc,KeyPairSigner.fromSecretKey(playerKey as KeyPairString))
const code=await rpc.viewAccount({accountId:'escrow.testnet',blockQuery:{finality:'final'}})
const chain=nearEscrowChain(rpc,owner,'escrow.testnet',code.code_hash)
const db=new Database(':memory:'), ledger=new Accounting(db,1_000_000)
const service=new EscrowRedemption(db,ledger,chain,'escrow.testnet','token.testnet','owner.testnet','treasury.testnet')
await service.initialize()
const intent=service.create(player.accountId)
await assert.rejects(service.authorize(player.accountId,intent.id),/unavailable/)
const transfer=await player.callFunctionRaw({contractId:'token.testnet',methodName:'ft_transfer_call',args:{receiver_id:'escrow.testnet',amount:'5000000',msg:intent.id},deposit:1n,gas:100000000000000n,waitUntil:'FINAL'})
assert.equal(transfer.final_execution_status,'FINAL')
assert.equal((await service.status(player.accountId,intent.id)).deposit?.status,'Pending')
await service.authorize(player.accountId,intent.id)
assert.equal(ledger.balance(player.accountId),0)
await player.callFunctionRaw({contractId:'escrow.testnet',methodName:'consume',args:{id:intent.id},deposit:0n,gas:30000000000000n,waitUntil:'FINAL'})
assert.deepEqual(await service.claim(player.accountId,intent.id),{credited:true})
assert.deepEqual(await service.claim(player.accountId,intent.id),{credited:false})
assert.equal(ledger.balance(player.accountId),1_000_000)
const rejected=service.create(player.accountId)
const bounced=await player.callFunctionRaw({contractId:'token.testnet',methodName:'ft_transfer_call',args:{receiver_id:'escrow.testnet',amount:'5000000',msg:rejected.id},deposit:1n,gas:100000000000000n,waitUntil:'FINAL'})
assert.deepEqual(await service.reconcileRejection(player.accountId,rejected.id,bounced.transaction.hash),{rejected:true})
assert.equal(ledger.balance(player.accountId),1_000_000)
db.close()
console.log('Sandbox gateway redemption and rejected-transfer reconciliation passed')
