import { expect,test } from 'bun:test'
import { Database } from 'bun:sqlite'
import type { JsonRpcProvider } from 'near-api-js'
import { Faucet } from '../src/faucet'
test('faucet makes one bounded claim per account',async()=>{
 const db=new Database(':memory:');let sends=0;const rpc={callFunction:async()=>({total:'1'})} as unknown as JsonRpcProvider
 const faucet=new Faucet(db,rpc,async()=>{sends++;return 'tx'},1)
 const [a,b]=await Promise.all([faucet.claim('alice.testnet'),faucet.claim('alice.testnet')])
 expect(sends).toBe(1);expect(a).toBeTruthy();expect(b).toBeTruthy()
 await expect(faucet.claim('bob.testnet')).rejects.toThrow('exhausted')
})
test('uncertain transfer is not retried and unregistered accounts cannot claim',async()=>{
 const db=new Database(':memory:');let sends=0;const rpc={callFunction:async({args}:{args:{account_id:string}})=>args.account_id==='unregistered.testnet'?null:{total:'1'}} as unknown as JsonRpcProvider
 const faucet=new Faucet(db,rpc,async()=>{sends++;throw new Error('uncertain')})
 await expect(faucet.claim('unregistered.testnet')).rejects.toThrow('Register')
 await expect(faucet.claim('alice.testnet')).rejects.toThrow('uncertain')
 expect(await faucet.claim('alice.testnet')).toMatchObject({state:'pending'});expect(sends).toBe(1)
})
