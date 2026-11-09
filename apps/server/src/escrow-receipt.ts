import { RequestError } from './errors'
/** Prove a specific transfer-call failed or returned the entire deposit. */
export function inspectRejectedDeposit(result:unknown,expected:{hash:string;account:string;token:string;escrow:string;id:string;amount:string}):void {
 const r=result as {final_execution_status?:string;status?:Record<string,unknown>;transaction?:{hash?:string;signer_id?:string;receiver_id?:string;actions?:Array<{FunctionCall?:{method_name?:string;deposit?:string;args?:string}}>}}|null
 if(!r||r.final_execution_status!=='FINAL'||!r.status)throw new RequestError('Transaction is not final',400)
 const tx=r.transaction,call=tx?.actions?.[0]?.FunctionCall
 if(tx?.hash!==expected.hash||tx.signer_id!==expected.account||tx.receiver_id!==expected.token||tx.actions?.length!==1||call?.method_name!=='ft_transfer_call'||call.deposit!=='1'||typeof call.args!=='string')throw new RequestError('Unexpected transaction',400)
 let args:{receiver_id?:unknown;amount?:unknown;msg?:unknown}
 try{args=JSON.parse(Buffer.from(call.args,'base64').toString('utf8'))}catch{throw new RequestError('Invalid transfer arguments',400)}
 if(args.receiver_id!==expected.escrow||args.amount!==expected.amount||args.msg!==expected.id)throw new RequestError('Transfer does not match intent',400)
 if('Failure' in r.status)return
 if(typeof r.status.SuccessValue!=='string')throw new RequestError('Transaction did not return a result',400)
 let used:unknown
 try{used=JSON.parse(Buffer.from(r.status.SuccessValue,'base64').toString('utf8'))}catch{throw new RequestError('Invalid transfer result',400)}
 if(used!=='0')throw new RequestError('Escrow did not reject the deposit',409)
}
