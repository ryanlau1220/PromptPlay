# PromptPlay

PromptPlay is a Testnet multiplayer game and planned inference redemption demo. It is under development; the game UI, redemption verification, gateway API and real inference are not yet available.

## Current implementation

- `contracts/compute-credit`: NEP-141 test credits and restricted minting. See `deployments/testnet.json` for the deployed Testnet token.
- `contracts/rps-game`: single-round escrow, commit–reveal, timeouts and payout claims. Not deployed yet.
- `apps/server`: internal allowance accounting and a gated provider adapter. No HTTP interface or chain verifier is implemented.

PCC is a Testnet demo asset. A configured mock is not real inference. Live inference is disabled by default and must only be enabled after funding and authorization are confirmed.

## Verification

Install Rust with `wasm32-unknown-unknown`, `cargo-near`, and Bun. Build each contract with `cargo near build non-reproducible-wasm` from its directory. Then run `cargo test --lib` and `cargo test --test sandbox` in `contracts/rps-game` (the sandbox test expects both contracts' WASM builds in their respective `target/near` directories). Run `bun test` in `apps/server`.

The sandbox test covers a two-player tie, asynchronous payout failure and retry; timeout behavior has unit tests but has not yet been tested against realistic sandbox timestamps. See `docs/DECISIONS.md` for constraints and remaining work.
