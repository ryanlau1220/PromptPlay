# PromptPlay judge walkthrough

## Practice in under a minute

Open the arcade and choose **Play the wallet-free demo**. Choose Paper, then Rock for a reproducible win. Claim the simulated pot, redeem 5 simulated PCC, and run the mock request to see the allowance debit. **Tic-Tac-Toe** in the game gallery opens a separate practice game with a deterministic opponent. Practice runs locally in the browser and awards no PCC. The separate Testnet agreement room requires two funded wallets to agree on a result. The RPS contract independently checks committed moves.

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
| `bun run test:apps` | 92 passed across web and server. Existing coverage includes escrow replay, uncertain reservations, refund recovery and metering. |
| `bun run build:web` | Passed |
| `bun run demo:mock` | Passed. First claim credited, replay credited nothing, and mock usage reduced allowance from 1,000,000 to 999,994 microunits. |
| Local service smoke | Web HTTP 200, backend health and Testnet config, and initial room WebSocket resync passed. Local faucet and live provider were disabled. |
| Contract builds and unit suites | All four Wasm builds completed. All 37 contract unit tests passed. The Rust downloader could not connect. A direct download succeeded, but the sandbox executable requires a file-descriptor limit of 65,535 and the workspace hard limit is 16,384. |
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
| P1.1 and P2.1 | The existing Tic-Tac-Toe computer opponent now chooses a winning move or blocks an immediate threat, then explains the decision. It is a reproducible rule-based opponent with zero external inference cost. The wallet-free RPS demo also adapts to the previous move and explains its choice. Both opponents use local rules and require no paid inference or wallet custody. |
| P1.2–P1.3 | The Inference Hub shows Testnet supply, redemption capacity, allowance and recorded usage. Each RPS room shows deposited, unsettled, pending, claimable and paid PCC. The walkthrough describes the fixed rate and who funds inference. |
| P1.4–P1.5 | Loaded match history shows completed matches, wins and paid stakes. Rooms show invitation, opponent readiness and RPC refresh states. Progress depends on on-chain outcomes and is scoped to loaded history. |
| P1.6 | Practice and shared settlement screens describe the separate mutual-agreement model and its trust boundary. |
| P1.7 and P2.4 | Added accessible input labels, status announcements, fullscreen controls, a scroll-snap gallery with button navigation, and reduced-motion fallbacks. Headless Chromium verified the wallet-free journey at 320px in light mode, 390px with reduced motion, and 1366px with ordinary motion. |
| P2.2 | Match summaries aggregate paid PCC across loaded contract records. Gateway totals aggregate credited, available, reserved, and charged microunits across its persistent ledger. Run `bun scripts/summarize-rps.ts` for chain settlement totals for the active multi-round RPS contract at a single finalized block. The command reports its coverage and separates paid and unsettled PCC. It excludes the legacy RPS and shared agreement contracts. The checked snapshot at block 277641039 covered all 5 matches in the active contract: 4 completed, 1 cancelled, 8 PCC deposited, 8 PCC paid including refunds, and 0 PCC unsettled. |
| P2.3 | The wallet-free demo includes a demand slider. The scenarios below show the fixed-rate economics at three demand levels. |
| P2.5 | Reviewed NEAR AI Cloud and NEAR Intents below. Testnet escrow and the existing gateway remain the demo path. |

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

### NEAR integration follow-up

- [NEAR AI Cloud](https://docs.near.ai/cloud/quickstart) documents an OpenAI-compatible provider path and independently verifiable inference. The existing gateway already accepts an OpenAI-compatible upstream. A provider trial needs an authorized funded account, verified model rates and capability checks. Displaying independently verifiable inference would also require retaining the inference identifier and verifying its attestation. The browser mock carries no provider identity or attestation.
- [NEAR Intents](https://docs.near-intents.org/) provides a cross-chain quote, swap and status flow. The judge journey already starts and ends with Testnet PCC, so a swap does not serve a demonstrated need in this sprint.

For an operator replay on the intended deployment, run the smoke command above with the actual public origins. Then run the signed browser journey with the existing two funded Meteor profiles and the operator's configured gateway and persistent ledger. Record the room ID, successful payout and escrow transaction hashes, and the allowance and recorded usage before and after one inference request. Environment variable names and recovery instructions are in the README. Keep the provider credentials, wallet profiles and reveal secrets on the operator machine.

### Wallet-free browser smoke test

With the web app running and Chromium installed through the Playwright setup in the README, run `python scripts/test-browser-demo.py`. Set `BROWSER_TEST_WEB_URL` to override the local web URL. The script checks the landing page, gallery, simulated payout and inference allowance at mobile and desktop widths.
