# PromptPlay — NEAR Hackathon submission

## Project links

- **Live Testnet app:** [promptplay-web.ryanlau1220.workers.dev](https://promptplay-web.ryanlau1220.workers.dev)
- **Repository:** [github.com/ryanlau1220/PromptPlay](https://github.com/ryanlau1220/PromptPlay)
- **Demo video:** [PromptPlay-DemoVideo.mp4](PromptPlay-DemoVideo.mp4) (2 minutes 15 seconds)
- **Run and verify:** [README](README.md)
- **Deployment records:** [deployments/testnet.json](deployments/testnet.json)
- **Suggested track:** [09 — Games With Real Economies](https://nearhackathon.com/#tracks). [07 — Agent Economy](https://nearhackathon.com/#tracks) is also relevant; select tracks in the submission form.

## What did you build?

PromptPlay turns downtime while a coding agent works into a game-to-compute loop on NEAR Testnet. Players can explore 11 wallet-free practice games or enter a two-player Rock Paper Scissors duel with PromptPlay Compute Credits (PCC). The game contract holds both stakes, verifies committed and revealed moves, and lets the winner claim the pot. PCC can then be deposited into a refundable redemption escrow and exchanged for a metered inference allowance.

A provider-configurable gateway exposes OpenAI-compatible endpoints. A player can create a gateway key and use the allowance with OpenCode or Pi while the upstream provider key stays on the server. The prototype also includes a shared arcade settlement contract: both players agree on a result, with timeout refunds if they cannot agree. Practice games do not award PCC, and their rules are not verified by that shared contract. This is a Testnet prototype, not a real-money game.

## Judge walkthrough

### No wallet or API key

1. Open the [live app](https://promptplay-web.ryanlau1220.workers.dev), pick a practice game, or choose **Play the wallet-free demo** to explore the simulated game-to-compute loop.
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
| Browser escrow verification | [Deposit transaction](https://testnet.nearblocks.io/txns/8scn6NncJbdW8TfAwZtDqgVpqHutbp1tUGvqZc8DCMc), with recovery, replay and live inference documented in the deployment record |
| Latest recorded CI for the preceding implementation | [Passing workflow](https://github.com/ryanlau1220/PromptPlay/actions/runs/43607102613); check the repository Actions tab for the submission commit |

The deployment record distinguishes browser-wallet tests, operator-signed SDK tests and isolated gateway tests. `bun run verify:testnet` checks recorded contract and transaction evidence without submitting transactions; see the README for its limits.

## Why it matters

- **Technical implementation:** NEAR contracts handle token transfers, escrow, commit–reveal, settlement and refunds; the server separately verifies redemption and meters provider usage.
- **Design:** The arcade and wallet-free simulation make the loop approachable before requiring two wallets. Wallet transactions remain visible and require confirmation.
- **Impact and originality:** A game stake has a concrete use in a developer's workflow: an allowance for an existing coding agent. This is a proposed use case, not a measured productivity improvement or a claim that play creates free compute.
- **Sustainability:** Operator-configured provider pricing, issuance capacity, reservations and request controls bound the demo. Real provider costs and funding remain external; the application is not a self-funding economy.

## Boundaries and known limitations

- All tokens and match activity described here are **Testnet**. PCC has no promised real-world value.
- Practice is solo and produces no PCC. Shared settlement relies on both players' agreement rather than on-chain verification of each game's rules.
- The project is a prototype and has not received an independent smart-contract audit. Provider compatibility is a tested subset, not a guarantee for every OpenAI-compatible client or model.
- Live inference and redemption depend on the operator's persistent database, configured provider, available capacity, RPC and wallet support. Local defaults do not enable paid inference or the faucet. The upstream key must remain server-side.
- The frontend and API are deployed, but their future availability and remaining provider funding are not guaranteed. No user adoption or productivity results have been measured.

## Submission form details

The [official submission page](https://nearhackathon.com/#submit) requests a project name, team lead, contact email, team size, tracks, prize wallet address, public repository, public X demo-post link, and a 20–2,000-character project description. Use the description above as a draft.

- **Project name:** PromptPlay
- **Repository:** https://github.com/ryanlau1220/PromptPlay
- **Website:** https://promptplay-web.ryanlau1220.workers.dev
- **Team lead, contact email, team size and prize wallet:** supply or confirm before submitting; the Testnet accounts above are deployment accounts, not a confirmed prize wallet.
- **Public X demo-post link:** add after the maintainer publishes the demo. The repository video file alone is not the requested public post.
- **Submission status:** prepared here; no X post or official form submission was made by this document.

The organizer says the repository and public demo-post links are required, and gives the deadline as **14 November 2026, 23:59 UTC** (**15 November 2026, 07:59 Singapore time**). Confirm the live form and deadline before submitting.
