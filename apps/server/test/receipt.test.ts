import { expect, test } from "bun:test";
import { inspectTransfer } from "../src/receipt";
const expected = {transactionHash:"tx", sender:"alice.testnet", token:"token.testnet", treasury:"treasury.testnet", amount:"5000000", memo:"intent:nonce"};
function fixture() {
  return { final_execution_status:"FINAL", status:{SuccessValue:""}, transaction:{hash:"tx",signer_id:expected.sender,receiver_id:expected.token,actions:[{FunctionCall:{method_name:"ft_transfer",deposit:"1",args:Buffer.from(JSON.stringify({receiver_id:expected.treasury,amount:expected.amount,memo:expected.memo})).toString("base64")}}]}, transaction_outcome:{outcome:{status:{SuccessReceiptId:"receipt"}}}, receipts_outcome:[{id:"receipt",outcome:{executor_id:expected.token,status:{SuccessValue:""},logs:[`EVENT_JSON:${JSON.stringify({standard:"nep141",version:"1.0.0",event:"ft_transfer",data:[{old_owner_id:expected.sender,new_owner_id:expected.treasury,amount:expected.amount,memo:expected.memo}]})}`]}}] };
}
test("accepts only the matching direct finalized transfer", () => { expect(inspectTransfer(fixture(), expected)).toBe("receipt"); });
test("rejects unfinalized, failed and mismatched receipts", () => {
  const unfinalized = fixture(); unfinalized.final_execution_status = "EXECUTED";
  const failed = fixture(); failed.receipts_outcome[0]!.outcome.status = {Failure:"error"} as any;
  const wrong = fixture(); wrong.transaction.receiver_id = "other.testnet";
  const noEvent = fixture(); noEvent.receipts_outcome[0]!.outcome.logs = [];
  for (const response of [unfinalized, failed, wrong, noEvent]) expect(() => inspectTransfer(response, expected)).toThrow();
  expect(() => inspectTransfer(fixture(), {...expected, memo:"different"})).toThrow();
  expect(() => inspectTransfer(fixture(), {...expected, amount:"1"})).toThrow();
});
