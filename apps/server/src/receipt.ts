/** Strictly inspect a direct ft_transfer result fetched from a trusted RPC using wait_until FINAL.
 * This does not authenticate the wallet, check the network, establish an intent's validity,
 * or fetch RPC itself. Those checks are required before granting an allowance. */
export function inspectTransfer(result: unknown, expected: {transactionHash:string; sender:string; token:string; treasury:string; amount:string; memo:string}): string {
  const r = result as { final_execution_status?: string; status?: Record<string, unknown>; transaction?: { hash?: string; signer_id?: string; receiver_id?: string; actions?: Array<{ FunctionCall?: { method_name?: string; deposit?: string; args: string } }> }; transaction_outcome?: { outcome?: { status?: { SuccessReceiptId?: unknown } } }; receipts_outcome?: Array<{ id: string; outcome?: { executor_id?: string; status?: Record<string, unknown>; logs?: unknown[] } }> } | null;
  if (!r || r.final_execution_status !== "FINAL" || !r.status || !("SuccessValue" in r.status)) throw new Error("Transaction not finalized successfully");
  const tx = r.transaction;
  if (!tx || tx.hash !== expected.transactionHash || tx.signer_id !== expected.sender || tx.receiver_id !== expected.token || !Array.isArray(tx.actions) || tx.actions.length !== 1) throw new Error("Unexpected transaction");
  const call = tx.actions[0]?.FunctionCall;
  if (!call || call.method_name !== "ft_transfer" || call.deposit !== "1") throw new Error("Expected direct token transfer");
  let args: { receiver_id?: string; amount?: string; memo?: string };
  try { args = JSON.parse(Buffer.from(call.args, "base64").toString("utf8")); } catch { throw new Error("Invalid transfer arguments"); }
  if (args.receiver_id !== expected.treasury || args.amount !== expected.amount || args.memo !== expected.memo) throw new Error("Transfer does not match intent");
  const receiptId = r.transaction_outcome?.outcome?.status?.SuccessReceiptId;
  if (typeof receiptId !== "string" || !Array.isArray(r.receipts_outcome)) throw new Error("Missing transfer receipt");
  const receipt = r.receipts_outcome.find((item) => item.id === receiptId);
  if (!receipt || receipt.outcome?.executor_id !== expected.token || !("SuccessValue" in (receipt.outcome?.status ?? {}))) throw new Error("Transfer receipt failed");
  const events = (receipt.outcome.logs ?? []).filter((log): log is string => typeof log === "string" && log.startsWith("EVENT_JSON:")).map((log:string) => {
    try { return JSON.parse(log.slice("EVENT_JSON:".length)) as {standard?: string; version?: string; event?: string; data?: Array<{old_owner_id?: string; new_owner_id?: string; amount?: string; memo?: string}>}; } catch { throw new Error("Invalid event"); }
  }).filter((event) => event.standard === "nep141" && event.version === "1.0.0" && event.event === "ft_transfer");
  if (events.length !== 1 || !Array.isArray(events[0].data) || events[0].data.length !== 1) throw new Error("Missing transfer event");
  const event = events[0].data[0];
  if (event.old_owner_id !== expected.sender || event.new_owner_id !== expected.treasury || event.amount !== expected.amount || event.memo !== expected.memo) throw new Error("Transfer event does not match intent");
  return receiptId;
}
