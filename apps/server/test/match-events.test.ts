import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import type { JsonRpcProvider } from 'near-api-js'
import { MatchEvents } from '../src/match-events'

test('indexes only finalized matching contract receipt events and deduplicates replay',async()=>{
 const db=new Database(':memory:'),hash='a'.repeat(44),receipt='b'.repeat(44)
 const event={standard:'promptplay_rps',version:'1.0.0',event:'match_created',data:[{sequence:'1',match:{id:'7',players:[{account:'alice.testnet'},{account:'bob.testnet'}]}}]}
 const rpc={viewTransactionStatus:async()=>({final_execution_status:'FINAL',transaction:{hash,signer_id:'alice.testnet'},receipts_outcome:[{id:receipt,outcome:{executor_id:'game.testnet',status:{SuccessValue:''},logs:[`EVENT_JSON:${JSON.stringify(event)}`]}}]})} as unknown as JsonRpcProvider
 const original=globalThis.fetch
 globalThis.fetch=(async input=>new Response(JSON.stringify(String(input).includes('/v1/txns/')?{txns:[{signer_account_id:'alice.testnet'}]}:{txns:[{transaction_hash:hash,receipt_id:receipt}]}))) as typeof fetch
 try{
  const index=new MatchEvents(db,rpc,'game.testnet');await index.ingest(hash,'alice.testnet');await index.sync();await index.sync()
  const events=index.events('7') as Array<{sequence:number;event:string;tx_hash:string}>
  expect(events).toHaveLength(1);expect(events[0]).toMatchObject({sequence:1,event:'match_created',tx_hash:hash})
 }finally{globalThis.fetch=original;db.close()}
})
test('does not index unfinalized transactions or another contract’s logs',async()=>{
 const db=new Database(':memory:'),hash='a'.repeat(44)
 const event={standard:'promptplay_rps',version:'1.0.0',event:'match_created',data:[{sequence:'1',match:{id:'7',players:[{account:'alice.testnet'},{account:'bob.testnet'}]}}]}
 let finality='EXECUTED',executor='game.testnet'
 const rpc={viewTransactionStatus:async()=>({final_execution_status:finality,transaction:{hash,signer_id:'alice.testnet'},receipts_outcome:[{id:'b'.repeat(44),outcome:{executor_id:executor,status:{SuccessValue:''},logs:[`EVENT_JSON:${JSON.stringify(event)}`]}}]})} as unknown as JsonRpcProvider
 const index=new MatchEvents(db,rpc,'game.testnet')
 await expect(index.ingest(hash,'alice.testnet')).rejects.toThrow('not finalized')
 finality='FINAL';executor='other.testnet';await index.ingest(hash,'alice.testnet')
 expect(index.events('7')).toHaveLength(0);db.close()
})

test('continues backfill with the provider cursor and restarts after the last page',async()=>{
 const db=new Database(':memory:'),hash='a'.repeat(44),receipt='b'.repeat(44),requests:string[]=[]
 const rpc={viewTransactionStatus:async()=>({final_execution_status:'FINAL',transaction:{hash,signer_id:'alice.testnet'},receipts_outcome:[{id:receipt,outcome:{executor_id:'game.testnet',status:{SuccessValue:''},logs:[]}}]})} as unknown as JsonRpcProvider
 const original=globalThis.fetch
 globalThis.fetch=(async input=>{
  const url=String(input);if(url.includes('/v1/txns/'))return new Response(JSON.stringify({txns:[{signer_account_id:'alice.testnet'}]}))
  requests.push(url)
  return new Response(JSON.stringify(requests.length===1?{cursor:'next+/=',txns:Array(25).fill({transaction_hash:hash,receipt_id:receipt})}:{cursor:null,txns:[]}))
 }) as typeof fetch
 try{
  const index=new MatchEvents(db,rpc,'game.testnet');await index.sync();await index.sync();await index.sync()
  expect(requests[0]).not.toContain('cursor=');expect(requests[1]).toContain('cursor=next%2B%2F%3D');expect(requests[2]).not.toContain('cursor=')
 }finally{globalThis.fetch=original;db.close()}
})
