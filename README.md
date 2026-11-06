# PromptPlay

PromptPlay is a NEAR Testnet arcade for developers waiting for coding agents. Two wallets can play a single round of rock, paper, scissors using Testnet PromptPlay Compute Credits (PCC). The contract escrows the stakes, verifies committed moves and makes the result and payout claimable on-chain.

The game has been exercised on Testnet through the CLI and two isolated browser test wallet adapters. A third-party browser wallet still needs end-to-end verification. The inference gateway has a deterministic mock and an OpenAI-compatible provider. A direct Nebius Token Factory request succeeded using the existing provider, but **live inference redemption remains disabled** while funding and permission for gateway use are unconfirmed.

## Run locally

Install Bun 1.3.10. Contract development also requires Rust with the `wasm32-unknown-unknown` target and `cargo-near`. From the repository root:

```sh
bun install --frozen-lockfile
bun run dev
```

Use `bun run dev:web` or `bun run dev:server` to start one app.

Open `http://localhost:3000`. The server defaults to `http://localhost:3001`, uses a local SQLite database, and checks that its NEAR RPC is on Testnet. `apps/server/.env.example` and `apps/web/.env.example` describe configuration. Bun loads `apps/server/.env.local` for local overrides; keep that file private.

To enable the **Testnet-only faucet**, use the dedicated pre-funded faucet account key file with `PROMPTPLAY_FAUCET_ENABLED=true` and `FAUCET_KEY_PATH` in the server's `.env.local`. Never use a player's wallet key. The faucet transfers 10 PCC once per authenticated account, with a total limit of ten claims. A transfer with an uncertain result stays pending for operator reconciliation and is not retried automatically.

For a local container setup, run `docker compose up --build`. The faucet and live inference are disabled by default. To enable the faucet, set `PROMPTPLAY_FAUCET_ENABLED=true` and `FAUCET_KEY_FILE` to the dedicated faucet credential file for Compose. Compose uses a persistent database volume. Run only **one faucet server against one persistent database**; separate databases cannot coordinate the claim limit. This Compose setup serves the web app in development mode and is intended for local use.

## Inference and redemption

The operator-funded demo rate is 5 PCC for one non-transferable gateway unit. Internally, one unit is 1,000,000 microunits. A unit's maximum funded inference cost and the model's input/output prices must be configured from verified provider terms before activation; this is a demo allowance, not a PCC cash peg or a provider-issued credit. The project-wide limit includes both issued allowance and pending redemption intents. Expired or uncertain unpaid intents remain reserved until reconciled, so they can exhaust the demo allocation.

Live operation requires an authorized, funded provider, a server-only provider key, confirmed model pricing/context limits, an explicit Testnet wallet allowlist, and the live, authorization and funding flags in `apps/server/.env.example`. The server also checks that the provider advertises the configured model before enabling redemption. Those conditions are **not currently verified**. The local development configuration uses Nebius Token Factory at `https://api.tokenfactory.nebius.com/v1` with `Qwen/Qwen3-30B-A3B-Instruct-2507`; its key stays in ignored server-side environment configuration. An isolated operator-only test verified a real Testnet payment, idempotent crediting, a Nebius response, and metered allowance deduction. Public PCC-to-inference gateway use has not been authorized or enabled; the test used temporary accounting rates, not verified billing rates. The mock is for tests and an offline demonstration only:

```sh
bun run demo:mock
```

The gateway supports `GET /v1/models` and non-streaming `POST /v1/chat/completions`; tool calling and coding-agent compatibility have not been established. Wallet sessions use signed NEP-413 challenges. API keys are shown once and stored hashed. The gateway reserves a conservative maximum before requests, reconciles provider-reported token usage at configured full input/output rates and retains reservations where execution is uncertain. The spending cap depends on accurate provider pricing and an input-token reservation at least as large as the provider model’s actual maximum context. The gateway checks reported usage after execution; it cannot prevent provider charges that exceed incorrectly configured limits or unmetered provider charges. Confirm these terms before enabling live use.

For a transfer that was submitted but not credited, sign in with the same wallet, open the existing intent and paste the transaction hash. Verification checks the final Testnet transaction, the particular successful PCC receipt, sender, treasury, amount, memo and execution time. Do not send a second payment for the same intent. The service records a payment attempt before the wallet opens, preventing another attempt through PromptPlay even on another device. If the wallet rejects or its response is lost, check wallet history and recover the original hash; reconciliation is required before retrying. Existing intents created before attempt tracking require manual review.

## Test and verify

Run these commands from the repository root:

- `bun run check` runs JavaScript/TypeScript lint, Rust formatting checks and both app type checks. The lint rules cover selected correctness and suspicious patterns; they are not a full security audit.
- `bun run build` builds both NEAR contracts and the web app; `bun run build:web` and `bun run build:contracts` run them separately.
- `bun run test` builds the contracts, runs both app test suites and the contract tests, including the NEAR sandbox integration test. Use `bun run test:apps` or `bun run test:contracts` for a subset.

Contract builds require the Rust WASM target and `cargo-near`; sandbox tests require access to the NEAR sandbox binary.

Testnet contract accounts, deployment transactions and controlled transaction evidence are in `deployments/testnet.json`. The sandbox covers a tie, callback spoof rejection, failed payout and retry. Timeout rules have unit tests but have not yet been verified using realistic sandbox timestamps. The contracts have not been audited. An isolated operator-only Nebius redemption was tested, but a third-party browser-wallet flow and an authorized public provider-funded demonstration remain unverified.

## Submission

The internal target is 13 November 2026. The [official deadline](https://nearhackathon.com/) is 14 November 2026 at 23:59 UTC (15 November at 07:59 Singapore time). The organizer requires a public repository and a public X demo post tagged `@NEARProtocol` and `#NEARHackathon`, with both links submitted through the official form. Publication, the demo post and submission remain pending; no changes have been pushed.

The hand illustrations are from [OpenMoji](https://openmoji.org/), licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
