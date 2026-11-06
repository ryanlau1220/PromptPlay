# PromptPlay

PromptPlay is a NEAR Testnet arcade for developers waiting for coding agents. Two wallets can play a single round of rock, paper, scissors using Testnet PromptPlay Compute Credits (PCC). The contract escrows the stakes, verifies committed moves and makes the result and payout claimable on-chain.

The game has been exercised on Testnet through the CLI and two isolated browser test wallet adapters. A third-party browser wallet still needs end-to-end verification. The inference gateway has a deterministic mock and an OpenAI-compatible provider. A direct Nebius Token Factory request succeeded using the existing provider, but **live inference redemption remains disabled** while funding and permission for gateway use are unconfirmed.

## Run locally

Install Node 24, pnpm, Bun, Rust with the `wasm32-unknown-unknown` target, and `cargo-near`. In separate terminals:

```sh
cd apps/server
pnpm install --frozen-lockfile
bun run dev
```

```sh
cd apps/web
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`. The server defaults to `http://localhost:3001`, uses a local SQLite database, and checks that its NEAR RPC is on Testnet. `apps/server/.env.example` and `apps/web/.env.example` describe configuration. Bun loads `apps/server/.env.local` for local overrides; keep that file private.

To enable the **Testnet-only faucet**, use the dedicated pre-funded faucet account key file with `PROMPTPLAY_FAUCET_ENABLED=true` and `FAUCET_KEY_PATH` in the server's `.env.local`. Never use a player's wallet key. The faucet transfers 10 PCC once per authenticated account, with a total limit of ten claims. A transfer with an uncertain result stays pending for operator reconciliation and is not retried automatically.

For a local container setup, run `docker compose up --build`. The faucet and live inference are disabled by default. To enable the faucet, set `PROMPTPLAY_FAUCET_ENABLED=true` and `FAUCET_KEY_FILE` to the dedicated faucet credential file for Compose. Compose uses a persistent database volume. Run only **one faucet server against one persistent database**; separate databases cannot coordinate the claim limit. This Compose setup serves the web app in development mode and is intended for local use.

## Inference and redemption

The operator-funded demo rate is 5 PCC for one non-transferable gateway unit. Internally, one unit is 1,000,000 microunits. A unit's maximum funded inference cost and the model's input/output prices must be configured from verified provider terms before activation; this is a demo allowance, not a PCC cash peg or a provider-issued credit. The project-wide limit includes both issued allowance and pending redemption intents. Expired or uncertain unpaid intents remain reserved until reconciled, so they can exhaust the demo allocation.

Live operation requires an authorized, funded provider, a server-only provider key, confirmed model pricing/context limits, an explicit Testnet wallet allowlist, and the live, authorization and funding flags in `apps/server/.env.example`. The server also checks that the provider advertises the configured model before enabling redemption. Those conditions are **not currently verified**. The local development configuration uses Nebius Token Factory at `https://api.tokenfactory.nebius.com/v1` with `Qwen/Qwen3-30B-A3B-Instruct-2507`; its key stays in ignored server-side environment configuration. A direct provider request succeeded, but an authorized PCC-to-inference flow has not been demonstrated. The mock is for tests and an offline demonstration only:

```sh
cd apps/server
bun run demo:mock
```

The gateway supports `GET /v1/models` and non-streaming `POST /v1/chat/completions`; tool calling and coding-agent compatibility have not been established. Wallet sessions use signed NEP-413 challenges. API keys are shown once and stored hashed. The gateway reserves a conservative maximum before requests, reconciles provider-reported token usage at configured full input/output rates and retains reservations where execution is uncertain. Provider limits and prices must be accurate for the configured model; the spending guarantee depends on those limits being respected.

For a transfer that was submitted but not credited, sign in with the same wallet, open the existing intent and paste the transaction hash. Verification checks the final Testnet transaction, the particular successful PCC receipt, sender, treasury, amount, memo and execution time. Do not send a second payment for the same intent.

## Test and verify

Build both contracts from their directories with `cargo near build non-reproducible-wasm`. Run `cargo test --lib` in `contracts/compute-credit` and `cargo test` in `contracts/rps-game`; the sandbox test expects both WASM builds in their respective `target/near` directories. Run `bun test` and `pnpm exec tsc` in `apps/server`, and `bun test test/game.test.ts`, `pnpm exec tsc --noEmit` and `pnpm build` in `apps/web`.

Testnet contract accounts, deployment transactions and controlled transaction evidence are in `deployments/testnet.json`. The sandbox covers a tie, callback spoof rejection, failed payout and retry. Timeout rules have unit tests but have not yet been verified using realistic sandbox timestamps. The contracts have not been audited; real inference, a third-party browser-wallet flow, and a complete provider-funded end-to-end demo remain unverified.

## Submission

The internal target is 13 November 2026. The [official deadline](https://nearhackathon.com/) is 14 November 2026 at 23:59 UTC (15 November at 07:59 Singapore time). The organizer requires a public repository and a public X demo post tagged `@NEARProtocol` and `#NEARHackathon`, with both links submitted through the official form. Publication, the demo post and submission remain pending; no changes have been pushed.

The hand illustrations are from [OpenMoji](https://openmoji.org/), licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
