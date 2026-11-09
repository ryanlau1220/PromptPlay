import { expect, test } from 'bun:test'
import { inspectRejectedDeposit } from '../src/escrow-receipt'
const expected={hash:'1'.repeat(40),account:'alice.testnet',token:'token.testnet',escrow:'escrow.testnet',id:'a'.repeat(32),amount:'5000000'}
function result(used:string,finality='FINAL') {return {final_execution_status:finality,status:{SuccessValue:Buffer.from(JSON.stringify(used)).toString('base64')},transaction:{hash:expected.hash,signer_id:expected.account,receiver_id:expected.token,actions:[{FunctionCall:{method_name:'ft_transfer_call',deposit:'1',args:Buffer.from(JSON.stringify({receiver_id:expected.escrow,amount:expected.amount,msg:expected.id})).toString('base64')}}]}}}
test('only a finalized matching refunded or failed transfer closes an intent',()=>{
 expect(()=>inspectRejectedDeposit(result('0'),expected)).not.toThrow()
 expect(()=>inspectRejectedDeposit({...result('0'),status:{Failure:{}}},expected)).not.toThrow()
 expect(()=>inspectRejectedDeposit(result('0','EXECUTED'),expected)).toThrow('not final')
 expect(()=>inspectRejectedDeposit(result('5000000'),expected)).toThrow('did not reject')
 expect(()=>inspectRejectedDeposit(result('0'),{...expected,id:'b'.repeat(32)})).toThrow('does not match')
 expect(()=>inspectRejectedDeposit(result('0'),{...expected,account:'bob.testnet'})).toThrow('Unexpected transaction')
})
