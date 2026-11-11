# Soulprint Web, Relayer & Indexer Implementation Plan (Plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the user-facing product: Studio, Commission room, capture UI, public Proof page, gated Holder vault, History, Resale; with an allowlisted relayer and an event indexer; verified by Playwright E2E against the local sandbox, then the demo.

**Architecture:** Next.js (App Router) web app talks to NEAR via NEAR Connect and to two small services: the relayer (NEP-366, strict allowlist) and the indexer (Neardata poller → Postgres) which serves history and lists. Ownership-gated actions always read the piece account as truth.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind, `@hot-labs/near-connect`, near-api-js, Fastify (relayer, indexer API), Postgres 16, Playwright, vitest.

**Spec:** `../../DESIGN.md` §3, §4, §6.4, §10, §11. Depends on Plan 1 (ABIs, `scripts/deploy-testnet.sh`, sandbox `world()`), Plan 2 (`@soulprint/proof`, evidence endpoints).

## Global Constraints
- Copy rule: in Studio, Commission room and capture UI never show the words "NFT", "mint", "gas", "wallet", "token" (lint test scans `app/(creator)` and `app/(client)` route groups). The Proof page "Verify on-chain" section and Resale page may.
- Proof page private until artist publishes; price never rendered; hours in bands.
- Vault: opens only when piece `status == Settled`, `owner == signer`, `transfer_pending == null`; signed URLs TTL 300 s bound to `rotation_seq`.
- Relayer allowlist: receivers = {collection, `p*.collection`, currency token}; methods = explicit list; max attached deposit 0.01 NEAR except `storage_deposit` 0.00125 NEAR; per-account daily cap 50 tx.
- Indexer accepts `soulprint` events only from the collection and accounts `p<N>.<collection>`; ignores `Income` below `MIN_INCOME`.
- Network config single source: `soulprint/config/networks.json` (sandbox, testnet, mainnet).

## Review Focus
1. **Client closes the tab mid-payment** — Commission room must reconcile from chain on reload (no local "paid" state); test `reload_after_fund_shows_funded_from_chain` (Task 3).
2. **Two tabs, two users act at once (accept vs. reject)** — UI must show the chain's winner and a clear message; test `concurrent_accept_reject_shows_chain_result` (Task 3).
3. **Proof page for a piece mid-dispute or refunded** — must not show "Commissioned and accepted"; test `badge_only_when_settled_by_commission` (Task 4).
4. **Indexer behind chain by minutes** — History must label itself "updating" rather than show wrong balances; test `history_shows_lag_indicator` (Task 6).
5. **Slow / mobile network on capture upload** — progress and retry visible, no silent loss; test `capture_upload_retry_visible` (Task 2).


## v2.2 Amendments — READ FIRST (override task text below)

Spec `DESIGN.md` §16 is binding (A33–A35, A39). ★ = demo path: Tasks 1, 2, 3, 4, 5, 8 (indexer and relayer can be replaced by RPC reads and pre-funded accounts for a demo).

- **Global Constraints:** copy lint scans **rendered strings** (Playwright text snapshot of the route groups), not source identifiers; forbidden words: NFT, mint, gas, wallet (drop "token"). Relayer receivers regex `^p[0-9]+\.<collection>$`; `create_piece` is not relayed (artists hold a little NEAR, or demo accounts are pre-funded). The relayer is for user actions only; services use their own sender accounts (A35).
- **Task 1 ★:** `useNear()` has two implementations chosen by config: NEAR Connect (testnet/mainnet) and a test signer holding keys from `config/networks.json` (sandbox/E2E). Spike: try email/passkey login via NEAR Connect wallets on testnet and record the result in `docs/spike-results.md`.
- **Task 2 ★:** PWA manifest + service worker + mobile capture route (`/capture/[pieceId]`); final/source file upload; story recording; publish toggle; challenge ack prompt. The artist creates the piece (contracts require the artist's capture key) — the client receives a link.
- **Task 3 ★:** messages, brief, references go through the evidence service endpoints (Plan 2 Task 3 amendments) with NEP-413 auth; "Get test USDC" calls `faucet` on mock-ft (sandbox/testnet mock) via a small route `app/api/faucet`.
- **Task 4 ★:** issuer class wording (A28), badge rule (A29), anchors per key segment, "device-reported" label (A38), recompute `report_hash` client-side from the public report (A36).
- **Task 5 ★:** add "Pay this piece" page `app/pay/[pieceId]` calling `pay_income` (demo step 4).
- **Task 6:** block source interface `BlockSource { next(fromHeight) }` with `RpcBlockSource` (sandbox) and `NeardataBlockSource`; event fixtures from `contracts/abi/`; reads `soulprint` events incl. `piece_created`, `owner_changed`.
- **Task 6 also (A55, A48):** process only successful receipt outcomes; no messages table (messages live in the evidence service).
- **Task 8 ★:** E2E boots `soulprint-sandbox` (Plan 1 Task 16) + services via docker compose; Chromium `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --auto-select-desktop-capture-source`; seconds-scale `TimeConfig`. README one-command run (`make demo`). Add submission checklist: public repo, README matches behaviour, demo video, form.

---

### Task 1: App shell, auth, config
**Files:** `apps/web/` scaffold, `apps/web/lib/{near,config,auth}.ts`, `apps/web/tests/copy-lint.test.ts`
**Produces:** `useNear(): {accountId, signIn(), signOut(), call(contract, method, args, deposit, gas)}`, `signNep413(message): {signature, publicKey, accountId}`; `config.network`.
- [ ] Tests: `copy_lint_forbidden_words_absent_in_creator_client_routes`, `nep413_roundtrip_verifies_on_server`.
- [ ] FAIL → implement → PASS → commit `feat(web): shell, auth, copy lint`.

### Task 2: Studio + capture UI
**Files:** `apps/web/app/(creator)/studio/**`, `apps/web/components/capture/*`
**Produces:** offer builder (all Terms fields with defaults from DESIGN; plain-language preview of grant), standalone piece creation, capture launcher using `CaptureSession` with session review grid (approve/discard), challenge code display, deliver flow (calls evidence `/report` then `piece.deliver`), earnings + `claim`/`claim_to`, privacy settings (publish proof page, hours banding).
- [ ] Tests (component + Playwright): `offer_defaults_match_spec`, `terms_hash_shown_equals_contract_terms_hash`, `discarded_frames_not_uploaded`, `capture_upload_retry_visible`.
- [ ] FAIL → implement → PASS → commit `feat(web): studio and capture`.

### Task 3: Commission room (client + artist)
**Files:** `apps/web/app/(client)/c/[pieceId]/**`, `apps/web/lib/commission.ts`
**Produces:** brief + references (uploaded to evidence service blob store, private), messages (Postgres via indexer API service, not on-chain), "Get test USDC" button (testnet/sandbox only), fund with `expected_terms_hash`, progress view (approved frames), challenge button, request changes / accept / reject (shows bond) / split proposals, refund when eligible, receipts PDF.
- [ ] Tests: `fund_sends_expected_terms_hash`, `reload_after_fund_shows_funded_from_chain`, `concurrent_accept_reject_shows_chain_result`, `reject_shows_bond_amount_before_confirm`, `refund_button_only_when_eligible`.
- [ ] FAIL → implement → PASS → commit `feat(web): commission room`.

### Task 4: Proof page
**Files:** `apps/web/app/p/[pieceId]/page.tsx`, `components/proof/*`
**Produces:** server-rendered from piece views + public report: evidence summary sentence (wording table from DESIGN §5), coverage map, timeline scrubber, challenges, story, rights summary, "Verify on-chain" (account, code hash, anchors, attestation key id + whether revoked), Limits page link.
- [ ] Tests: `wording_matches_level_table`, `badge_only_when_settled_by_commission`, `revoked_key_downgrades_display`, `private_until_published`, `price_never_rendered`.
- [ ] FAIL → implement → PASS → commit `feat(web): proof page`.

### Task 5: Holder vault + resale
**Files:** `apps/web/app/vault/[pieceId]/**`, `apps/web/app/buy/[pieceId]/**`, `apps/web/app/api/vault/route.ts`
**Produces:** vault API: verify NEP-413, read piece at final block, `sync_owner` + retry if index lags, issue 300 s signed URLs bound to `rotation_seq`; vault UI: files, full grant + addenda, `withdraw`, list/delist; buy page: `buy(nonce, max_price, expected_pool_min)` with the pool shown.
- [ ] Tests: `vault_denied_before_settled`, `vault_denied_during_transfer_pending`, `old_holder_vault_denied_after_transfer`, `buy_sends_nonce_max_price_pool_min`, `lagging_index_triggers_sync_not_deny`.
- [ ] FAIL → implement → PASS → commit `feat(web): vault and resale`.

### Task 6: Indexer + history
**Files:** `services/indexer/src/{poller,ingest,api}.ts`, `db/migrations/*`
**Produces:** Neardata poller from a configured start block; filters receipts by executor (collection + `p<N>.collection`); parses `EVENT_JSON:` logs with standard `soulprint`; tables `pieces`, `events`, `holders`, `messages`; API `GET /pieces/:id/history`, `GET /artists/:id/pieces`, `GET /lag`.
- [ ] Tests: `rejects_events_from_foreign_accounts`, `ignores_dust_income`, `history_reconstructs_balances_from_events` (fixture event stream vs expected accounting), `history_shows_lag_indicator`.
- [ ] FAIL → implement → PASS → commit `feat(indexer): events and history`.

### Task 7: Relayer
**Files:** `services/relayer/src/{server,allowlist}.ts`
**Produces:** `POST /relay` accepting signed `SignedDelegate`; enforces allowlist (Global Constraints); submits; returns outcome. If Spike S2 said no wallet supports delegate signing, this service only performs `storage_deposit` registrations and demo-account top-ups.
- [ ] Tests: `rejects_unlisted_receiver`, `rejects_unlisted_method`, `rejects_deposit_over_cap`, `enforces_daily_cap`, `relays_valid_anchor`.
- [ ] FAIL → implement → PASS → commit `feat(relayer): allowlisted relayer`.

### Task 8: E2E, README, demo
**Files:** `e2e/*.spec.ts`, `README.md`, `docs/demo-script.md`
- [ ] Playwright against sandbox + services (docker compose): `commission_happy_path`, `revision_then_accept`, `refund_after_deadline`, `dispute_each_stage`, `standalone_proof`, `resale_with_income_race` (DESIGN §10 steps 4–5), `vault_gating_after_transfer`.
- [ ] README: what it is, how to run, the transfer threat model table copied verbatim from DESIGN §7, accepted limits from §14 (incl. L9: in-flight URLs ≤ 5 min), residual trust, deployed code hashes.
- [ ] Demo script following DESIGN §10 with exact accounts and amounts; rehearse once end-to-end on testnet; record timings.
- [ ] Run full suite: `pnpm -r test && pnpm e2e && (cd contracts && cargo test --workspace)`; expected all PASS.
- [ ] Commit `docs: README, threat model, demo`.
