# PromptPlay — NEAR Hackathon submission

## Project links

- **Live Testnet app:** [promptplay-web.ryanlau1220.workers.dev](https://promptplay-web.ryanlau1220.workers.dev)
- **Repository:** [github.com/ryanlau1220/PromptPlay](https://github.com/ryanlau1220/PromptPlay)
- **Demo video:** [PromptPlay-DemoVideo.mp4](PromptPlay-DemoVideo.mp4) (2 minutes 15 seconds)
- **Run and verify:** [README](README.md)
- **Deployment records:** [deployments/testnet.json](deployments/testnet.json)
- **Recommended primary track:** [13 — Open Innovation](https://nearhackathon.com/#tracks): an entertainment-to-compute loop connecting transferable ownership and AI utility.
- **Recommended secondary track:** [09 — Games With Real Economies](https://nearhackathon.com/#tracks): game results change ownership of transferable PCC. The prototype does not implement an autonomous marketplace.

## What did you build?

PromptPlay turns downtime while a coding agent works into a game-to-compute loop on NEAR Testnet. Players can explore 11 wallet-free practice games or enter a two-player Rock Paper Scissors duel with PromptPlay Compute Credits (PCC). The game contract holds both stakes, verifies committed and revealed moves, and lets the winner claim the pot. PCC can then be deposited into a refundable redemption escrow and exchanged for a metered inference allowance.

A provider-configurable gateway exposes OpenAI-compatible endpoints. A player can create a gateway key and use the allowance with OpenCode or Pi while the upstream provider key stays on the server. The prototype also includes a shared arcade settlement contract: both players agree on a result, with timeout refunds if they cannot agree. Practice games do not award PCC, and their rules are not verified by that shared contract. This is a Testnet prototype, not a real-money game.

## Judge walkthrough

### No wallet or API key

1. Open the [live app](https://promptplay-web.ryanlau1220.workers.dev), choose **Play the wallet-free demo**, and play **Paper**, then **Rock**. Claim the simulated payout, redeem 5 simulated PCC, and run the mock request: the displayed allowance becomes `0.999994 units`. The 11 practice games are also wallet-free.
2. Run `bun install --frozen-lockfile`, `bun run dev`, then open `http://localhost:3000`. The local app also works without a wallet; Testnet RPC access is required for the server.
3. Run `bun run demo:mock` to exercise simulated redemption, replay protection, a mock response and metering without an upstream key or on-chain payment.
4. Run `bun run check`, `bun run test:apps`, and `bun run build:web`. For contracts, install the Rust/Wasm tools in the README and run `bun run test:contracts`.

### Real Testnet flow

Use two separate NEAR Testnet wallet profiles with Testnet NEAR and PCC. Create a Duel Arena room, deposit both stakes, commit and reveal from the same profiles, and claim the payout. In Inference Hub, sign in, create an intent, deposit 5 PCC, authorize consumption and create a gateway key. Use the provided agent configuration with that key. Testnet gas, wallet confirmations, faucet funding, provider capacity and the operator's gateway configuration are required.

The video uses real Testnet match footage and a live gateway-backed OpenCode file read. The match and agent run use different Testnet accounts, and the redemption section uses earlier verification evidence; it is not a single uninterrupted recording of the entire wallet-to-agent journey. The terminal segment presents the real agent events in a formatted view and does not expose the key.

## What is implemented

- **Game and economy:** NEP-141 PCC; first-to-two RPS with commit–reveal, deadlines and asynchronous payout recovery; a shared two-player escrow with mutually agreed outcomes and timeout refunds.
- **Player experience:** 11 solo practice games, a wallet-free simulation, wallet transactions, match history and optional match-resolution Web Push.
- **PCC to inference:** NEP-413 wallet sessions, refundable redemption escrow, finalized-state checks, replay protection, hashed gateway keys, allowances, reservations and metered usage.
- **Agent integration:** OpenAI-compatible Chat Completions and a stateless subset of Responses. OpenCode and Pi have completed file-read tasks through the gateway; the provider and model are configurable.

## NEAR integration and evidence

| Component | Testnet account / evidence |
| --- | --- |
| PCC token | [`token.ryanlau1220.testnet`](https://testnet.nearblocks.io/address/token.ryanlau1220.testnet) |
| RPS contract | [`game2.ryanlau1220.testnet`](https://testnet.nearblocks.io/address/game2.ryanlau1220.testnet) |
| Shared settlement | [`arcade.ryanlau1220.testnet`](https://testnet.nearblocks.io/address/arcade.ryanlau1220.testnet) |
| Redemption escrow | [`redeem.ryanlau1220.testnet`](https://testnet.nearblocks.io/address/redeem.ryanlau1220.testnet) |
| Continuous browser test, match 11 | [2 PCC payout](https://testnet.nearblocks.io/txns/H8tfJDLCQdYxjeqdkqt9nXdCnir7Ce7AYwATHS8Y1MNA) and [5 PCC redemption](https://testnet.nearblocks.io/txns/9AB2LdfgLbppe5k4wLMRFMDNq4vyeGpYEetMYdYtx3GR), both for `arcade-a.ryanlau1220.testnet`. The escrow record is approved and consumed. The same browser test recorded replay rejection, browser inference and an OpenCode file read; allowance changed from `9.668900` to `9.667329` units during the agent run. |
| Current demo match 10 | [Payout transaction](https://testnet.nearblocks.io/txns/GVGyAX3Cyqy1eSYkmvQCrt7JjNNwUuyJYvyWk61KXh7M): a successful NEP-141 receipt transferred 2 PCC to `arcade-a.ryanlau1220.testnet` |
| Separate browser redemption | [Deposit transaction](https://testnet.nearblocks.io/txns/B6BD8jpL1W199bfFdJ6qUyTjKyTEYDCCZZ2pBWzM186Q): a successful NEP-141 receipt transferred 5 PCC from the same account to the redemption escrow. This does not establish that the match 10 payout funded this deposit. |
| Browser escrow verification | [Deposit transaction](https://testnet.nearblocks.io/txns/8scn6NncJbdW8TfAwZtDqgVpqHutbp1tUGvqZc8DCMc), with recovery, replay and live inference documented in the deployment record |
| CI before this audit | [Passing workflow for `5bee050`](https://github.com/ryanlau1220/PromptPlay/actions/runs/43613698518); check the repository Actions tab for the final submission commit |

The deployment record distinguishes browser-wallet tests, operator-signed SDK tests and isolated gateway tests. `bun run verify:testnet` checks the match 11 payout and consumed escrow, along with other recorded contract and transaction evidence, without submitting transactions. The browser runner's off-chain inference and allowance results are not independently verified by that chain-only command.

## Why it matters

- **Technical implementation:** NEAR contracts handle token transfers, escrow, commit–reveal, settlement and refunds; the server separately verifies redemption and meters provider usage.
- **Design:** The arcade and wallet-free simulation make the loop approachable before requiring two wallets. Wallet transactions remain visible and require confirmation.
- **Impact and originality:** A game stake has a concrete use in a developer's workflow: an allowance for an existing coding agent. This is a proposed use case, not a measured productivity improvement or a claim that play creates free compute.
- **Sustainability:** Operator-configured provider pricing, issuance capacity, reservations and request controls bound the demo. Real provider costs and funding remain external; the application is not a self-funding economy.

## Competitive context

This is a source-and-documentation comparison, not an independent execution, security audit or ranking of the other projects. Their repositories include tests and demonstrations, but their live systems and outcomes were not independently verified in this audit.

| Project | Repository evidence and distinction |
| --- | --- |
| [Lantern Caravan](https://github.com/JahanzaibMohsin9/lantern_caravan) | Implements [inventory-based pricing](https://github.com/JahanzaibMohsin9/lantern_caravan/blob/main/packages/game-core/src/pricing.ts) and an NEP-245 item contract. Its merchant economy is deeper than PromptPlay's duel; PromptPlay connects PCC to agent inference. |
| [THE RULE](https://github.com/Dylansius11/The-Rule) | Has a [game contract](https://github.com/Dylansius11/The-Rule/blob/main/contracts/game/src/lib.rs), sandbox tests and a TEE-based secret-law game. Its README labels mock-referee screenshots and states the TEE trust boundary. PromptPlay uses commit–reveal and does not claim TEE privacy. |
| [NPC-Town](https://github.com/PRANAV0443s/npc-town) | Offers a wallet-free village simulation and includes [demo-mode tests](https://github.com/PRANAV0443s/npc-town/blob/main/scripts/test-demo-mode.js); its README distinguishes simulated settlement from optional Testnet transactions. PromptPlay's offline game is smaller but has a separate compute-redemption path. |
| [TEE Receipts](https://github.com/tmdry4530/tee-receipts) | Contains an [on-chain receipt contract](https://github.com/tmdry4530/tee-receipts/blob/main/contracts/receipts/src/lib.rs), saved evidence and sandbox tests. It addresses verifiable private-inference receipts, which PromptPlay does not provide. |
| [x402Interop](https://github.com/the3rdweblabs/x402Interop) | Implements [payment middleware](https://github.com/the3rdweblabs/x402Interop/blob/main/packages/servers/src/middleware.ts) and tests; its README marks some chain families unimplemented and describes NEAR Intents custody. PromptPlay focuses on a single Testnet credit and metered gateway, not cross-chain payments. |
| [SwarmCompute](https://github.com/emmyloyal/swarmcompute) | Includes a [marketplace contract](https://github.com/emmyloyal/swarmcompute/blob/main/contracts/marketplace/src/lib.rs), commitments and host tests. Its README labels GPU delivery and verification simulated. PromptPlay does not offer a compute marketplace. |
| [PayPerCall](https://github.com/devx-agent/near-paypercall) | Implements [per-call escrow](https://github.com/devx-agent/near-paypercall/blob/main/contract/src/lib.rs) and a sandbox test. PromptPlay instead redeems PCC into an allowance that can cover multiple metered inference requests. |

The highest-value lesson for PromptPlay is a short, reproducible judge path with clear on-chain links and honest simulation labels. Extra NPCs, marketplaces or token features would not improve this specific loop enough to justify their risk before submission.

## Implementation audit

This is an internal review, not an independent security audit. Severity reflects the prototype's operating risks rather than a claim of a demonstrated exploit.

| Priority | Finding and evidence | Action and status |
| --- | --- | --- |
| P1 | Meteor can remain on a wallet confirmation screen, and session restoration may still be in progress when the browser runner checks the header. Both interrupted earlier runs; no transaction was submitted by the failed restoration attempt. | The runner now waits for a connected account or connection control, and handles Meteor's **Close Wallet** confirmation. The complete match 11 → redemption → OpenCode run passed with this change. |
| P1 | RustSec flags `crypto-bigint` 0.5.5 timing variability and unmaintained `unsafe-libyaml` 0.2.11 in the contract lockfiles. | Open host-side dependency findings. Neither appears in the normal Wasm dependency trees; assess upstream dependency upgrades and affected host use before production. |
| P1 | Provider billing, configured prices and model limits, the escrow approval key, and a single persistent SQLite ledger remain operational trust boundaries. | Retain metering limits, restricted approval, backups and reconciliation. Actual upstream charges and availability remain external; do not reset the ledger. |
| P1 | The issuer can mint PCC, and a finalized Testnet access-key query found a full-access key on each deployed contract account. | Documented administrative trust: the relevant key holders can redeploy contract code. The backend approval key is restricted to the escrow `approve` method; do not describe the contracts as immutable. |
| P1 | Shared arcade results are player assertions; a refusing or disagreeing player can delay resolution until the timeout. | Documented limitation. Either participant can resolve after the deadline and funded stakes are refundable; this does not prove fair play. |
| P2 | The match 11 browser test verified continuous winner-to-redemption-to-agent execution, but did not record a continuous video. | Chain state, payout and deposit receipts are reproducible with `bun run verify:testnet`; off-chain inference evidence is the runner trace. The existing video uses separate footage. |

## Boundaries and known limitations

- All tokens and match activity described here are **Testnet**. PCC has no promised real-world value.
- Practice is solo and produces no PCC. Shared settlement relies on both players' agreement rather than on-chain verification of each game's rules.
- The project is a prototype and has not received an independent smart-contract audit. Provider compatibility is a tested subset, not a guarantee for every OpenAI-compatible client or model.
- The Rust lockfile audit reports a timing-variability advisory in `crypto-bigint` 0.5.5 and unmaintained `unsafe-libyaml` 0.2.11. Both are absent from the four contracts' normal Wasm dependency trees, but the host-side dependency findings remain open; see the README for advisory links.
- Live inference and redemption depend on the operator's persistent database, configured provider, available capacity, RPC and wallet support. Local defaults do not enable paid inference or the faucet. The upstream key must remain server-side.
- The frontend and API are deployed, but their future availability and remaining provider funding are not guaranteed. No user adoption or productivity results have been measured.
- Community-contributed permissionless games and a compute marketplace are future ideas, not implemented features.

## Submission form details

The [official submission page](https://nearhackathon.com/#submit) requests a project name, team lead, contact email, team size, tracks, prize wallet address, public repository, public X demo-post link, and a 20–2,000-character project description. Use the description above as a draft.

- **Project name:** PromptPlay
- **Repository:** https://github.com/ryanlau1220/PromptPlay
- **Website:** https://promptplay-web.ryanlau1220.workers.dev
- **Team lead, contact email, team size and prize wallet:** supply or confirm before submitting; the Testnet accounts above are deployment accounts, not a confirmed prize wallet.
- **Other hackathon entries:** the organizer permits at most two independent projects per person and requires each README to name the other; confirm whether this applies to any team member.
- **License:** [MIT](LICENSE).
- **Public X demo-post link:** add after the maintainer publishes the demo. The repository video file alone is not the requested public post.
- **Submission status:** prepared here; no X post or official form submission was made by this document.

The organizer says the repository and public demo-post links are required, and gives the deadline as **14 November 2026, 23:59 UTC** (**15 November 2026, 07:59 Singapore time**). Confirm the live form and deadline before submitting.
