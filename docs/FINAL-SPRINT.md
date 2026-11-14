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
| `bun run test:apps` | 90 passed across web and server. Existing coverage includes escrow replay, uncertain reservations, refund recovery and metering. |
| `bun run build:web` | Passed |
| `bun run demo:mock` | Passed. First claim credited, replay credited nothing, and mock usage reduced allowance from 1,000,000 to 999,994 microunits. |
| Local service smoke | Web HTTP 200, backend health and Testnet config, and initial room WebSocket resync passed. Local faucet and live provider were disabled. |
| Contract builds and unit suites | All four Wasm builds completed. All 37 contract unit tests passed. The full suite stopped at the RPS sandbox binary download with a connection refusal. |
| Archival Testnet verifier | The original full verifier passed. A full rerun of the extended verifier timed out on the alternate RPC. The new escrow code hash and settings were verified separately on Testnet. |
| Chromium smoke | Environment denied Chromium's socket creation. |
| Fresh wallet-to-live-provider journey | Requires funded wallet profiles, an eligible account and the operator's gateway configuration. Public hosting availability remains unverified. |

The next operator check is the real Testnet walkthrough against the intended public web and API URLs. Use the existing wallet profiles, operator configuration and persistent ledger. See the [README](../README.md#test-and-verify) for the full test commands.

## Backlog status

| Item | Branch outcome |
| --- | --- |
| P0.1 | The walkthrough covers wallet and funding prerequisites, stake acceptance, reveal recovery, transfer confirmation, redemption and inference. A fresh signed run still needs the operator's wallet profiles and gateway. |
| P0.2–P0.3 | The lobby opens directly into wallet-free practice or Testnet. Claim, conversion, allowance and proof links are visible at the relevant steps. |
| P0.4 | Match reads distinguish loading, missing room and RPC failure. Funded players can see when the opponent is next. Payouts and redemption recover from confirmed failures or interrupted requests through existing claim and refresh paths. |
| P0.5 | App and contract unit suites cover conservation, refunds, replay, failed callbacks, duplicate claims and gateway reservations. Full sandbox coverage requires the sandbox binary. |
| P0.6 | Lint, type checks, app tests, production web build, deterministic mock and read-only Testnet checks were run. |
| P0.7 | The production web build and local HTTP, CORS and WebSocket checks passed. Public endpoint URLs and live provider access are operator inputs. |
| P1.1 and P2.1 | The existing Tic-Tac-Toe computer opponent now chooses a winning move or blocks an immediate threat, then explains the decision. It is a reproducible rule-based opponent with zero external inference cost. An LLM-controlled or wallet-owning opponent remains deferred. |
| P1.2–P1.3 | The Inference Hub shows Testnet supply, redemption capacity, allowance and recorded usage. Each RPS room shows deposited, unsettled, pending, claimable and paid PCC. The walkthrough describes the fixed rate and who funds inference. |
| P1.4–P1.5 | Loaded match history shows completed matches, wins and paid stakes. Rooms show invitation, opponent readiness and RPC refresh states. Progress depends on on-chain outcomes and is scoped to loaded history. |
| P1.6 | Practice and shared settlement screens describe the separate mutual-agreement model and its trust boundary. |
| P1.7 and P2.4 | Added accessible input labels and status announcements, mobile-friendly wrapping, and concise match feedback. Runtime browser layout verification is pending. |
| P2.2 | Match summaries aggregate paid PCC from loaded contract records. Project-wide statistics require a defined index coverage window and verified indexing completeness. |
| P2.3 | The scenarios below document the fixed-rate economics under three demand levels. |
| P2.5 | Existing Testnet escrow, wallet auth and inference metering provide the evidence for the current loop. A second settlement path or inference attestation integration remains deferred. |

### Illustrative capacity scenarios

Assume 500 PCC distributed from a pre-funded faucet, one unit for every 5 PCC, 50 remaining redemption units, and no capacity replenishment. These values are scenario assumptions. A 5 PCC stake on each side moves 10 PCC into escrow and returns 10 PCC to the winner upon a successful claim, with zero issuance from gameplay.

| Redemption demand | PCC received by redemption escrow | Units funded | Units left | Unmet requests |
| --- | ---: | ---: | ---: | ---: |
| 10 requests | 50 | 10 | 40 | 0 |
| 50 requests | 250 | 50 | 0 | 0 |
| 80 requests | 250 | 50 | 0 | 30 |

The example assumes each accepted redemption completes. The 250 PCC transferred in the last two cases does not imply a reduction in issued token supply. Inference spending depends on provider usage and the operator's funding. For a deployment smoke check without signing, run:

```sh
bun scripts/check-demo.mjs WEB_URL API_URL
```

The script checks the web response, backend health, CORS, Testnet configuration and WebSocket resync. A configured model is evidence of configuration only. To prove live inference, perform walkthrough steps 5–6 with an eligible wallet on the same deployment.
