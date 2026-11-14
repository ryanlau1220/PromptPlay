# PromptPlay judge walkthrough

## Practice in under a minute

Open the arcade and choose **Try practice · no wallet**. In Tic-Tac-Toe, play against the computer and use **Restart** for another round. Practice runs locally in the browser and awards no PCC. The separate Testnet agreement room requires two funded wallets to agree on a result. The RPS contract independently checks committed moves.

## Follow one real Testnet payout into inference

1. Open **Start a Testnet duel**. Connect two distinct Testnet wallets in separate browser profiles. Both need Testnet NEAR for gas and applicable storage deposits, PCC storage registration and enough PCC for the stake. The optional faucet distributes 10 previously funded PCC once per eligible account. It is a source of starter credits, separate from the pot.
2. Create a match with the opponent's account and share its room link. Both players deposit. Wait for the room to show both funded before choosing moves. Inspect the transaction link when acceptance is uncertain. A successful outer token call can still return unaccepted tokens under the [NEP-141 transfer-call flow](https://github.com/near/NEPs/blob/master/neps/nep-0141.md).
3. Commit and reveal each round in the same browser profile. The first player to two round wins takes the pot. Keep the profile and its stored reveal secrets. A tied round repeats. WebSockets prompt a refresh, and contract state determines the match phase. After a deadline, use the room's timeout action and check the resulting claim.
4. Claim the payout and check its transaction in NearBlocks. The winner receives both stakes, which includes their own original stake. A failed PCC transfer restores the claim. If the result is uncertain, check wallet history, the explorer and refreshed match state before retrying.
5. Open the **Inference Hub**, sign the wallet challenge, and check redemption availability. An eligible wallet with at least 5 PCC and available capacity can create a redemption, deposit PCC, authorize and consume it, then claim one gateway unit. The deposit and latest escrow transaction links provide chain references. If interrupted, reconnect with the same wallet and refresh or recover the existing deposit. A consumed deposit can be claimed after reload. Check the original transfer before sending PCC again.
6. Submit a prompt in the playground and compare allowance and usage before and after. The operator funds inference. One gateway unit equals 1,000,000 internal microunits and is debited at the configured model rates. The 5 PCC conversion is a fixed demo rule. At capacity, new issuance pauses under the existing contract and gateway limits.

For a read-only reference, inspect the recorded [Testnet payout](https://testnet.nearblocks.io/txns/D36kn5CyprFoBVs4EggaWqbq5BdJ8PPi27rPfgx9sv6P) and [escrow deposit](https://testnet.nearblocks.io/txns/8scn6NncJbdW8TfAwZtDqgVpqHutbp1tUGvqZc8DCMc). These are separate evidence records. See [the deployment manifest](../deployments/testnet.json) for their scope. Run `bun run demo:mock` for deterministic simulated redemption, replay and metering using an in-memory database.

## Sprint implementation and verification

The baseline is upstream `main` at `85117194445e084d0897e6e11345328b2db30c4e`. The change covers the lobby, practice view, wallet entry screens, RPS payout handling, wallet balance display, gateway configuration and redemption feedback. It uses the existing contracts, accounting, provider and deployment configuration.

| Check | Result |
| --- | --- |
| Bun 1.3.10 frozen install | Passed |
| `bun run check` | Lint, Rust formatting and both app type checks passed |
| `bun run test:apps` | 88 passed across web and server. Existing coverage includes escrow replay, uncertain reservations, refund recovery and metering. |
| `bun run build:web` | Passed |
| `bun run demo:mock` | Passed. First claim credited, replay credited nothing, and mock usage reduced allowance from 1,000,000 to 999,994 microunits. |
| Local service smoke | Web HTTP 200, backend health and Testnet config, and initial room WebSocket resync passed. Local faucet and live provider were disabled. |
| Contract suite and archival Testnet verifier | Invoked. Completion remained unconfirmed when this handoff was written. |
| Chromium smoke | Environment denied Chromium's socket creation. |
| Fresh wallet-to-live-provider journey | Requires funded wallet profiles, an eligible account and the operator's gateway configuration. Public hosting availability remains unverified. |

The next operator check is the real Testnet walkthrough against the intended public web and API URLs. Use the existing wallet profiles, operator configuration and persistent ledger. See the [README](../README.md#test-and-verify) for the full test commands.
