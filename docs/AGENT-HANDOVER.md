# PromptPlay agent handover

14 November 2026, Malaysia time

Start from `origin/codex/final-hackathon-sprint`. The latest implementation commit before this handover is `4292a8f`. Review the branch against current `main` before merging. The [sprint report](FINAL-SPRINT.md) tracks the original P0–P2 backlog and contains the judge walkthrough.

## What shipped

- The landing page offers a playable wallet-free story, a scroll-snap game gallery, a manually stepped workspace preview, and optional fullscreen. Motion follows the reduced-motion preference. The demo covers RPS, a simulated PCC payout, redemption, a mock inference debit, and a separate demand slider.
- Duel and shared-settlement screens handle failed, uncertain and confirmed wallet outcomes separately. Match history loads in bounded RPC batches. A match ID is loaded on submit. Gateway recovery includes explicit account refresh, previously created deposit recovery, and precise allowance display.
- The Testnet verifier retries transient reads and checks recorded chain evidence. The browser smoke script exercises the landing page, full demo, compact light mode, fullscreen, keyboard navigation, Tic-Tac-Toe, Sequence replay, 2048 controls, all eleven practice routes, and recovery after an interrupted demo download.

## Reproduce the checks

```sh
bun install --frozen-lockfile
bun run check
bun run test:apps
bun run build:web
bun run demo:mock
bun run verify:testnet
bun run dev:web
```

Run `python scripts/test-browser-demo.py` separately with Playwright and Chromium installed as documented in the README. Override the web URL with `BROWSER_TEST_WEB_URL`. For the shortest judge demo, open **Play the wallet-free demo**, choose **Paper** then **Rock**, claim, redeem, and run mock inference. The allowance should end at `0.999994` units.

## Verified and pending

| Area | Result |
| --- | --- |
| Local checks | Lint, type checks, 92 app tests, production web build, and deterministic mock passed. |
| Browser | Chromium passed at 320px, 390px and 1366px. The last repeated browser pass ran against the production build. |
| Chain | The full read-only Testnet verifier passed, including deployed code hashes, recorded payouts and payments, and escrow settings. This checks historical evidence. |
| Contracts | Four Wasm builds and 37 unit tests passed earlier. The local sandbox executable requires a file-descriptor limit this workspace cannot raise. |
| GitHub Actions | Verification skipped at Ryan's request. |
| Deployment and live journey | Public hosting and a fresh signed wallet-to-provider run remain pending. |

## Resume in this order

1. Review the sprint branch and run the checks above in the target checkout.
2. When deployment resumes, use Cloudflare only with its default `workers.dev` address. Cloudflare sign-in was paused. The Bun/SQLite backend still needs a tested Cloudflare-compatible persistence path. Preserve transaction atomicity, ledger recovery, rate limits, and one authoritative writer before enabling live redemption. The separate local Docker preparation was for the earlier VPS option and is outside this sprint branch.
3. On the intended deployment, run `bun scripts/check-demo.mjs WEB_URL API_URL`. Then use the operator's funded Testnet wallets, authorized provider and restricted escrow approval key to run one real duel → payout → redemption → metered inference. Save the public transaction hashes and allowance before and after. Keep secrets and the ledger in the operator environment.

The browser simulations move no funds. The active Testnet contracts and production ledger were untouched during this pass.
