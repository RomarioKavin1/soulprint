# Soulprint Contracts Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the collection and piece contracts of Soulprint v2.1 with every threat-model mitigation, proven by unit tests, a model-based fuzzer and sandbox integration tests.

**Architecture:** Piece logic lives in a pure, environment-free core (`PieceCore`) that takes a `Ctx` (predecessor, attached deposit, now, prepaid gas) and returns `Effects` (outgoing transfers, events). The near-sdk contract wrapper only translates between the chain and the core. That lets a proptest model drive millions of operation sequences, including callback failures, against the exact production logic. The collection is an immutable, keyless NEP-171 index and factory that creates one sub-account per piece from a global contract published by code hash.

**Tech Stack:** Rust 1.86+, near-sdk 5.30.x, near-workspaces 0.24.x (sandbox), proptest 1.x, borsh 1.x, cargo-near for reproducible wasm builds.

**Spec:** `../../DESIGN.md` (v2.1). Also read `../../critique/security.md` (finding IDs C1–C3, H1–H7, M1–M8, L1–L9 referenced below) and `../../critique/near-tech.md`.

## Global Constraints

- Repo root: `~/Documents/RandomClaudeSessions/near-nfts-hack/soulprint/`; contracts in `soulprint/contracts/` (cargo workspace).
- near-sdk `5.30.x`; global contracts require ≥ 5.25.0 (ungated). near-workspaces `0.24.x`.
- Release profile: `overflow-checks = true`, `opt-level = "z"`, `lto = true`, `codegen-units = 1`, `panic = "abort"`, `debug = false`.
- Piece wasm size budget: ≤ 300 KB (CI check fails above).
- `assert_one_yocto()` on every owner-, artist-, arbitrator- and governance-gated method; only `anchor` is exempt.
- Never compute an owed amount from a balance query; balances only appear in invariant checks.
- Every outgoing promise with a callback uses static gas constants from `common::gas`; entry points `require!(env::prepaid_gas() >= MIN_*)`.
- Defaults (verbatim from spec): grace 48h; review window ≥ 3 days (default 7); revision rounds default 2; milestones ≤ 5, sum = 10000 bps; royalty 0–1500 bps (default 500); reject bond 500 bps; dispute ladder 7d negotiation → 14d arbitrator → 14d fallback → `timeout_artist_bps` (default 5000); vectors capped: anchors 512, challenges 32, addenda 8, verifier keys 8.
- Event standard name: `soulprint`, version `1.0.0`, NEP-297 format.
- Report signing message: borsh struct `ReportMessage { domain: "soulprint-report-v1", network: String, piece_id: AccountId, final_file_hash: [u8;32], last_anchor_head: [u8;32], last_anchor_count: u32, capture_pubkey: [u8;32], evidence_level: u8, report_hash: [u8;32], issued_at: u64 }`. Field order is normative (Plan 2 must produce identical bytes; shared test vector in Task 2).
- Anchor signing message: borsh `AnchorMessage { domain: "soulprint-anchor-v1", piece_id, head: [u8;32], count: u32 }`. Chain genesis: `sha256(piece_id_bytes ‖ capture_pubkey)`.
- Commits: conventional commits; no Co-Authored-By trailer.

## Review Focus

1. **Callback failure under minimum gas / zero storage headroom.** A user claiming to an unregistered USDC account must always get the credit back. Test `claim_to_unregistered_ft_restores_credit_min_gas_zero_headroom` in Task 10.
2. **Time edges.** An action exactly at `deadline + grace`, `delivered_at + review_window` and each dispute-ladder boundary must follow one rule (inclusive start, exclusive end). Test `boundary_times_inclusive_exclusive` in Task 4.
3. **Rounding.** Milestone bps and royalty bps on prices not divisible by 10000 must never leave dust or overpay. The last release takes the remainder. Test `rounding_never_leaves_dust` in Task 5 (proptest over prices 1..=u128::MAX/10001).
4. **Double-submission / replay.** The same `fund`, `buy` or `accept_split` sent twice (wallet retry) must succeed once and fail cleanly the second time. Test `duplicate_submission_is_idempotent_or_rejected` in Task 6.
5. **Account-id edge cases.** Pieces receiving from implicit (64-hex) accounts, eth-implicit (`0x…`) accounts and the artist == client case. Test `implicit_and_eth_accounts_supported`, `artist_cannot_be_client` in Task 6.


## v2.2 Amendments — READ FIRST (override task text below)

Spec `DESIGN.md` §16 (A1–A39) is binding. Per task:

- **Global Constraints:** Rust 1.95 toolchain; reproducible wasm build only in deploy (`cargo near build` non-reproducible in dev). Replace "exactly 1 yocto" with A13 (`attached ≥ 1 yocto`, surplus pays storage/bond, excess refunded); the test becomes `gated_methods_require_at_least_one_yocto`. Add `cargo clippy -D warnings` and `cargo audit` to `scripts/build.sh` (Task 1). ★ marks demo-path tasks: 0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 16.
- **Task 2 ★:** add `TimeConfig` (A9), `StandaloneTerms` (A25), `BatchMessage` (A27), `ReportMessage` unchanged; `domain` is a borsh `String`. Add `revision_period` to `Terms`, bounds from A23. Produce `contracts/abi/` fixtures: method JSON schemas, view result samples, one sample per event (A34 names, snake_case, all fields). Plan 2/3 consume these. Tests add: `abi_fixtures_roundtrip`, `batch_message_test_vector`, `terms_validate_bounds` covers A23.
- **Task 3 ★:** `Ctx` gains `payer: AccountId` (= predecessor for NEAR calls, `sender_id` for FT calls) and `token: Option<AccountId>`; `capture_keys: Vec<PublicKey>` (≤ 4). Add `invites` (≤ 16).
- **Task 4 ★:** replace `effective_status` semantics with A10: `fn materialise(&mut self, now) -> Effects` (performs due transitions incl. accounting) and `fn view_status(&self, now) -> Status` (pure). Tests add `materialise_settles_and_credits_artist_on_review_lapse`, `views_equal_materialised_status`.
- **Task 5 ★:** A3 (`fund` → owner change, seq+1, NotifyCollection), A11 (`request_changes_extends_deadline`, `request_changes_then_claim_refund_fails`), A12 (milestone release anytime in order; `mutual_cancel_outcome`), A23 (`fund_rejected_within_one_day_of_deadline`, `funder_not_artist_or_arbitrator`), A25 (`settle_standalone(final_file_hash, report_hash)`, `reopen_as_standalone_after_refund`).
- **Task 6 ★:** `reject` takes the bond via NEAR attach or FT `reject` action (A14); `accept_split(expected_artist_bps, proposal_nonce)` in all stages (A20); remove `client_keeps_token` — outcome derived from share (A21); default `timeout_artist_bps = 7500` (A22). Tests add `reject_with_ft_bond`, `bond_counted_in_liabilities`, `accept_split_rejects_changed_proposal`, `accept_split_allowed_in_every_stage`, `split_outcome_derived_from_share` (0, 4999, 5000, 10000), `timeout_outcome_matches_terms`.
- **Task 7 ★:** A13/A16: `claim_to` gated (≥ 1 yocto), `claim_to_self_piece_rejected`, `restore_callback_never_checks_balance` (balance set to pre-refund value), `new_owner_can_withdraw_on_min_reserve_ft_piece` (withdraw carries storage deposit).
- **Task 8 ★:** `MIN_LIST_PRICE` comes from the collection's per-currency `min_list_units` copied at init; no `MIN_INCOME` guess — `min_income_units` the same way. Addenda blocked while listed (A30) test `addendum_blocked_while_listed`.
- **Task 9 ★:** `anchor(key: PublicKey, head, count, sig)` per key segment (A26); `add_capture_key`; challenges per A28 (`issue_challenge(nonce_hash)`, `ack_challenge(challenge_id, sig_by_capture_key)`, no on-chain result; tests `challenge_rate_limited`, `one_open_challenge`, `per_issuer_cap`); `record_attestation(msg: ReportMessage, key_id: u16)` checks A24 (tests `attestation_bound_to_final_file_hash`, `attestation_bound_to_anchor_head`, `older_attestation_cannot_replace_newer`, `redeliver_clears_attestation`, `standalone_can_be_attested`); `accept_addendum(index, expected_hash)`; pending proposal outside cap.
- **Task 10 ★:** A1/A2: `expire_pending()`, `rotate_rejected_while_pending`, `rotate_rejects_self_piece_collection_receiver`, `transfer_pending_expires_and_reverts`, `late_resolve_after_expiry_is_noop`.
- **Task 11:** ops add `nft_transfer` during pending, `expire_pending`, `CallbackLost(slot)` (callback never runs; assert no double payment and funds recoverable via restore path), `request_changes` at every offset from the deadline, interleaved `propose_split`/`accept_split`; invariant "pending is cleared within expiry by a permissionless op"; I1 includes bond.
- **Task 12 ★:** A14 ABI for `ft_on_transfer` msg (fixture from Task 2); A17 flush-then-check storage; wasm import scan test `piece_wasm_imports_no_admin_host_fns` (A8).
- **Task 13 ★:** A4 private callbacks (`collection_callbacks_are_private`), A5 `new(...)` signature with `initial_verifier_keys` and `TimeConfig`, piece code hash as `const PIECE_CODE_HASH` generated by build script, A6 burn-on-failure (`create_piece_burns_id_on_failure`), A7 key management (`ninth_key_after_revocations_can_be_added`, `pending_key_can_be_cancelled`), A1 bounded resolve read, A19 partial FT registration, A34 nep171 events from applied pairs.
- **Task 14 ★:** add `transfer_call_receiver_returns_4mib_still_resolves`, `resolve_path_does_not_grow_collection_storage`, `collection_storage_covered`, `collection_created_keyless_in_one_tx`, `collection_genesis_state_is_clean`, `create_piece_with_paused_token_registers_piece_and_partial_refund`, `function_call_key_cannot_list_withdraw_accept` (real FC key), `claim_for_other_account_not_possible`, `collection_account_cannot_rotate_piece`, cap tests for challenges/addenda/keys/invites, `views_paginate` (L8), `failed_near_transfer_callback_before_refund`. `setup.rs` waits for global contract distribution before the first `create_piece`. Use seconds-scale `TimeConfig`.
- **Task 15:** deploy script creates the collection keylessly in one transaction (A5) via a small Rust bin (`tools/genesis`), records the genesis tx hash; soak shortened to 1h with seconds-scale `TimeConfig` and also reconciles the **indexer** (Plan 3 Task 6) against chain.
- **Final-pass additions (A40–A57):** Task 1 starts with `git init`, installing `cargo-near` and `near` CLI, and Rust 1.95, then cleans the stale text listed in `critique/traceability.md` §7B. Task 2 writes the complete event list with fields and every view's fields (A45), `PieceKind`/`create_piece(kind, capture_pubkey)` (A50) and the currency config (A46). Move `new_owner_can_withdraw_on_min_reserve_ft_piece` to Task 14 and `addendum_blocked_while_listed` to Task 9 (X-20). Task 11 drops `CallbackLost` (A53). Task 13 implements `on_rotated` + `on_rotate_resolved` (A40) and prefunds collection storage (A51). Task 14 adds `faucet` to mock-ft (A52), `fund_notify_succeeds_on_ft_piece_without_extra_deposit`, `callbacks_succeed_at_min_gas`, and `pay_income_rejected_on_personal_grant` (A56).
- **New Task 16 ★ — `soulprint-sandbox` binary (A39):** `tools/sandbox/src/main.rs`: boot sandbox, publish global code, wait for distribution, genesis collection, deploy mock-ft (decimals 6), fund demo accounts, write `config/networks.json` with RPC URL + account ids + test keys, stay up until SIGINT. Test: `sandbox_bin_writes_config_and_serves_views` (spawn, read config, call `nft_metadata`).

---

## File structure

```
soulprint/contracts/
  Cargo.toml                       workspace
  common/src/lib.rs                shared types re-exported
  common/src/terms.rs              Terms, Grant, Milestone, Currency, terms_hash()
  common/src/messages.rs           ReportMessage, AnchorMessage, genesis()
  common/src/events.rs             SoulprintEvent enum → NEP-297 json
  common/src/gas.rs                gas constants
  piece/src/core/mod.rs            PieceCore struct, Ctx, Effects, Error
  piece/src/core/status.rs         Status, effective_status()
  piece/src/core/commission.rs     fund, deliver, request_changes, accept, release, claim_refund, cancel, extend
  piece/src/core/dispute.rs        reject, propose/accept_split, resolve, timeout_resolve
  piece/src/core/accounting.rs     credits, in_flight, claim/withdraw/restore
  piece/src/core/resale.rs         list, delist, buy, pay_income
  piece/src/core/proof.rs          anchor, challenge, record_attestation, addenda
  piece/src/core/ownership.rs      rotate_owner, transfer_pending, resolve_transfer
  piece/src/contract.rs            #[near] wrapper: env → Ctx, Effects → promises/events, storage checks
  piece/tests/model.rs             proptest model + invariants I1–I6
  collection/src/lib.rs            #[near] Collection
  collection/src/nft.rs            hand-rolled NEP-171/177/181
  collection/src/factory.rs        create_piece batch + callback
  collection/src/attest.rs         attest(), key set, governance
  publisher/src/lib.rs             publishes piece wasm as global contract by hash (test/deploy helper)
  mock-ft/src/lib.rs               NEP-141 with storage registration, blacklist, pause (test only)
  evil-receiver/src/lib.rs         nft_on_transfer that drains/blocks/returns (test only)
  tests/src/*.rs                   near-workspaces integration tests
  scripts/build.sh                 cargo near build reproducible + size check
  scripts/deploy-testnet.sh        publish, deploy collection, delete keys, verify zero keys
```

---

### Task 0: Spikes S1, S2, S5 (throwaway; decisions recorded)

**Files:** Create: `soulprint/spikes/` (throwaway; not merged into contracts), `soulprint/docs/spike-results.md`

- [ ] **S1 Global contract.** Minimal publisher contract calls `Promise::new(env::current_account_id()).deploy_global_contract(wasm)`; a factory then creates `a.<factory>` with `create_account + transfer + use_global_contract(hash) + function_call(init)` in near-workspaces. Record: burn for publishing, gas of the creation batch, per-account storage after init. Pass = the child answers a view with the global code; measured per-piece cost is ≤ 0.06 NEAR.
- [ ] **S2 Delegate actions.** Using NEAR Connect in a scratch Next page with 2 wallets available on testnet, try `signDelegateAction`. Record which wallets work. Decision: if none do, use relayer = no; demo accounts are pre-funded.
- [ ] **S5 Testnet USDC.** Confirm the testnet USDC contract (`3e2210e1…afcb8af` per near-tech.md, full id from that file) supports `storage_deposit` and find a faucet. Decision: real testnet USDC or `mock-ft` deployed to testnet for the demo.
- [ ] Write the three decisions to `soulprint/docs/spike-results.md`; commit `chore: record spike results`.

### Task 1: Workspace, build and size gate

**Files:** Create: `contracts/Cargo.toml`, `contracts/rust-toolchain.toml`, `scripts/build.sh`, crate skeletons for all members.

- [ ] Write `scripts/build.sh` running `cargo near build reproducible-wasm` per contract, failing if `piece.wasm` > 300 KB.
- [ ] Run `cargo test --workspace` (empty) and `scripts/build.sh`; expected: success, sizes printed.
- [ ] Commit `chore: contracts workspace and build gate`.

### Task 2: Common types, hashes, signing messages

**Files:** `common/src/{terms,messages,events,gas}.rs`; Test: `common/src/tests.rs`

**Interfaces — Produces:**
- `enum Currency { Near, Ft(AccountId) }`
- `struct Milestone { bps: u16 }`
- `enum GrantType { Personal, CommercialNonExclusive, CommercialExclusive, FullAssignment }` (ordered by width)
- `struct Grant { kind: GrantType, attribution: bool, transferable: bool }`
- `struct Terms { price: u128, currency: Currency, milestones: Vec<Milestone>, deadline_ns: u64, grace_ns: u64, review_window_ns: u64, revision_rounds: u8, arbitrator: AccountId, fallback_arbitrator: AccountId, timeout_artist_bps: u16, reject_bond_bps: u16, royalty_bps: u16, grant: Grant, licence_text_hash: [u8;32], client: Option<AccountId> }`
- `fn Terms::validate(&self, artist: &AccountId, now: u64) -> Result<(), TermsError>` with the bounds from Global Constraints (+ deadline in (now + 1 day, now + 365 days); arbitrators ∉ {artist, client}; arbitrator ≠ fallback)
- `fn Terms::hash(&self) -> [u8;32]` = sha256(borsh(self))
- `ReportMessage`, `AnchorMessage`, `fn genesis(piece: &AccountId, pk: &[u8;32]) -> [u8;32]`, `fn ReportMessage::signing_bytes(&self) -> Vec<u8>`
- `enum SoulprintEvent { Funded{..}, Anchored{..}, Challenged{..}, ChallengeResult{..}, Delivered{..}, ChangesRequested{..}, MilestoneReleased{..}, Settled{..}, Rejected{..}, SplitProposed{..}, Resolved{..}, Refunded{..}, Cancelled, Income{..}, Withdraw{..}, Claim{..}, ClaimRestored{..}, Listed{..}, Delisted, Sold{..}, Rotated{..}, Attested{..}, AddendumAccepted{..} }` with `fn emit(&self)`; amounts serialized as strings.

- [ ] Tests: `terms_validate_bounds` (one case per bound, each rejected with a specific `TermsError` variant), `terms_hash_changes_on_any_field` (mutate each field → different hash), `report_message_test_vector` (fixed input → hex bytes written to `common/test-vectors/report-v1.json`, consumed by Plan 2), `anchor_message_test_vector` (same, `anchor-v1.json`), `genesis_test_vector`.
- [ ] Run `cargo test -p common`: FAIL, then implement, then PASS.
- [ ] Commit `feat(common): terms, signing messages, events`.

### Task 3: PieceCore skeleton, Ctx/Effects, auth helpers

**Files:** `piece/src/core/mod.rs`; Test: inline `#[cfg(test)]`.

**Interfaces — Produces:**
- `struct Ctx { predecessor: AccountId, attached: u128, now: u64, prepaid_gas: u64 }`
- `enum Effect { TransferNear{to, amount, slot: SlotId}, TransferFt{token, to, amount, slot: SlotId}, Event(SoulprintEvent), NotifyCollection{seq: u64, owner: AccountId} }`
- `type Effects = Vec<Effect>`; `enum Error` (one variant per rejection reason; `Display` strings stable for tests)
- `struct PieceCore { piece_id, collection, mode: Mode, artist, owner, rotation_seq: u64, status: Status, transfer_pending: Option<Pending>, terms: Terms, terms_hash: [u8;32], funded: u128, escrow: u128, released: u128, refunded: u128, holder_pool: u128, credits: BTreeMap<AccountId, Slot>, pool_in_flight: u128, listing: Option<Listing>, listing_nonce: u64, consents: Consents, proof: Proof, addenda: Vec<Addendum>, revisions_used: u8, released_milestones: u8, delivered_at: Option<u64>, disputed_at: Option<u64>, bond: u128 }`
- `struct Slot { available: u128, in_flight: u128, prefunded: bool }`; `enum SlotId { Credit(AccountId) }`
- `fn PieceCore::new_commission(piece_id, collection, artist, terms, capture_pubkey, now) -> Result<Self, Error>`, `fn new_standalone(piece_id, collection, artist, capture_pubkey) -> Self`
- `fn require_one_yocto(ctx) -> Result<(), Error>`, `fn require_owner(ctx)`, `fn require_artist(ctx)`, `fn require_not_pending(&self)`

- [ ] Tests: `new_commission_owner_is_artist_status_offered`, `new_commission_prefunds_credit_slots_artist_client_arbitrators`, `require_one_yocto_rejects_0_and_2`.
- [ ] FAIL → implement → PASS → commit `feat(piece): core skeleton`.

### Task 4: Status machine and `effective_status`

**Files:** `piece/src/core/status.rs`

**Interfaces — Produces:** `enum Status { Offered, InProgress, Delivered, Disputed(DisputeStage), Settled, Refunded, Cancelled }`, `enum DisputeStage { Negotiation, Arbitrator, Fallback, TimedOut }`, `fn effective_status(&self, now: u64) -> Status` (lazy transitions: Delivered + review lapsed → Settled-eligible; InProgress + now ≥ deadline+grace → RefundEligible flag; Disputed stage from `disputed_at` offsets 7d/21d/35d).

Time rule: a window `[start, end)` — at `now == end` the window has closed.

- [ ] Tests: `review_window_lapse_makes_settle_eligible`, `deadline_plus_grace_opens_refund`, `dispute_stage_progression_7_21_35_days`, `boundary_times_inclusive_exclusive` (Review Focus 2: at `end-1` open, at `end` closed, for every window).
- [ ] FAIL → implement → PASS → commit `feat(piece): lazy status machine`.

### Task 5: Commission flow (fund, deliver, revisions, milestones, accept, refund, cancel, extend)

**Files:** `piece/src/core/commission.rs`

**Interfaces — Produces (all `&mut self, ctx: &Ctx, … -> Result<Effects, Error>`):**
`fund(expected_terms_hash: [u8;32], amount: u128, beneficiary: Option<AccountId>)` (amount comes from attached NEAR or FT; exact match to price + 0; owner ← beneficiary or predecessor; enforces `terms.client` if set), `deliver(final_file_hash: [u8;32], report_hash: [u8;32])` (artist; sets `Delivered`, `delivered_at` synchronously — H1), `request_changes()` (owner; ≤ revision_rounds; → InProgress), `release_milestone(index: u8)` (owner; in order; credits artist; auto-release of due milestones when review lapses), `accept()` (owner; releases remaining escrow as remainder → Settled), `settle()` (anyone, when review lapsed), `claim_refund()` (owner; refund-eligible; credits owner remaining escrow; grant void; owner ← artist; seq+1), `cancel()` (artist, Offered only), `consent_mutual_cancel()` / `consent_extend(new_deadline)` (both parties; consents bound to `rotation_seq`), `settle_standalone()` (artist, Standalone).

- [ ] Tests:
  - `fund_rejects_changed_terms_hash` (H3), `fund_requires_exact_amount`, `fund_twice_rejected`, `fund_respects_named_client` (L7)
  - `deliver_is_synchronous_and_beats_late_refund` (H1: deliver at deadline+grace−1 then claim_refund fails)
  - `request_changes_limited_to_rounds`
  - `milestones_release_in_order_and_sum_to_funded`
  - `rounding_never_leaves_dust` (proptest prices, bps vectors summing to 10000: `released + refunded + escrow == funded` and final escrow == 0) — Review Focus 3
  - `accept_releases_remainder_and_settles`, `settle_by_anyone_after_review_lapse`
  - `refund_voids_grant_and_returns_token_to_artist` (H6)
  - `mutual_cancel_consent_cleared_on_rotation` (M4)
  - `standalone_settles_without_escrow`
- [ ] FAIL → implement → PASS → commit `feat(piece): commission flow`.

### Task 6: Dispute ladder

**Files:** `piece/src/core/dispute.rs`

**Interfaces — Produces:** `reject(bond: u128)` (owner; within review window; bond = price × reject_bond_bps / 10000 exact), `propose_split(artist_bps: u16)` / `accept_split()` (parties, Negotiation stage; acceptance must match the latest proposal of the other party), `resolve(artist_bps: u16, client_keeps_token: bool)` (arbitrator in Arbitrator stage, fallback in Fallback stage; split only between artist and owner), `timeout_resolve()` (anyone, TimedOut stage; uses `terms.timeout_artist_bps`). Bond goes to the larger share's party (tie → artist). Grant active iff artist share ≥ 5000.

- [ ] Tests: `reject_after_window_fails_without_settle_poke` (M2), `split_requires_counterparty_acceptance`, `arbitrator_only_in_its_stage`, `fallback_only_after_21d`, `arbitrator_cannot_pay_third_party`, `resolve_split_sums_to_escrow`, `bond_to_winner`, `grant_active_only_if_artist_share_ge_half`, `transfer_blocked_while_disputed`, `duplicate_submission_is_idempotent_or_rejected` (Review Focus 4: double accept_split, double fund, double buy), `artist_cannot_be_client`, `implicit_and_eth_accounts_supported` (Review Focus 5).
- [ ] FAIL → implement → PASS → commit `feat(piece): dispute ladder`.

### Task 7: Accounting — credits, in-flight, claim, withdraw, restore

**Files:** `piece/src/core/accounting.rs`

**Interfaces — Produces:** `claim() -> Effects` (pays predecessor; amount → `in_flight`; Effect::Transfer* with slot), `claim_to(recipient: AccountId)`, `on_transfer_result(slot: SlotId, amount: u128, ok: bool)` (moves `in_flight` → gone or back to `available`; never touches the pool; never creates a slot), `withdraw()` (owner, Settled, not listed, not pending, pool > 0, no claim of owner in flight: pool → `credits[owner]` then claim).

- [ ] Tests: `claim_pays_predecessor_only` (H5.3), `failed_claim_restores_creditor_not_pool` (T3), `second_claim_while_in_flight_rejected`, `withdraw_zero_pool_rejected` (L3), `restore_never_grows_storage` (asserts slot count unchanged across failure), `withdraw_blocked_while_listed` (T1).
- [ ] FAIL → implement → PASS → commit `feat(piece): pull-payment accounting`.

### Task 8: Resale and income

**Files:** `piece/src/core/resale.rs`

**Interfaces — Produces:** `list(price: u128, reserved_for: Option<AccountId>)` (owner, Settled, not pending, price ≥ `MIN_LIST_PRICE` = 0.1 NEAR or 0.1 unit FT, nonce = ++counter), `delist()`, `buy(nonce: u64, max_price: u128, expected_pool_min: u128, amount: u128)` (exact amount == price ≤ max_price; buyer ≠ seller; respects reserved_for; royalty = price × royalty_bps / 10000 → artist; rest → seller; owner ← buyer; seq+1; listing/consents cleared; NotifyCollection), `pay_income(amount: u128)` (Settled; amount ≥ `MIN_INCOME`; → holder_pool; Income event).

- [ ] Tests: `buy_rejects_changed_nonce` (T13), `buy_fails_if_pool_below_expected` (T1), `buy_by_seller_rejected`, `buy_requires_exact_amount` (M6), `listing_nonce_never_reused`, `income_before_and_after_buy_goes_to_buyer` (T2), `royalty_and_seller_credit_sum_to_price`, `reserved_listing_only_for_reserved_buyer`, `list_blocked_before_settled`.
- [ ] FAIL → implement → PASS → commit `feat(piece): resale and income`.

### Task 9: Proof — anchors, challenges, attestation, addenda

**Files:** `piece/src/core/proof.rs`

**Interfaces — Produces:** `anchor(head: [u8;32], count: u32, sig: [u8;64])` (anyone; verifies ed25519 over `AnchorMessage` with `capture_pubkey`; count strictly increasing; ≤ 512; InProgress or Offered-standalone), `invite_challenger(account: AccountId)` (artist), `challenge(nonce_hash: [u8;32])` (client or invited; ≤ 32), `record_attestation(report_hash, level: u8, key_id: u8)` (collection only; report_hash must equal stored), `propose_addendum(kind: GrantType, attribution: bool, text_hash)` (artist; must widen enum/flags) / `accept_addendum(index)` (owner).

Signature verification lives in core behind a trait `Verifier { fn ed25519(&self, sig, msg, pk) -> bool }` so the model can use a real implementation (ed25519-dalek in tests) and the contract uses `env::ed25519_verify`.

- [ ] Tests: `anchor_requires_capture_key_signature`, `anchor_count_monotonic`, `anchor_cap_enforced`, `challenge_only_client_or_invited`, `attestation_only_from_collection`, `attestation_report_hash_must_match`, `addendum_must_widen`, `addendum_requires_holder`, `terms_hash_immutable_after_fund` (M3).
- [ ] FAIL → implement → PASS → commit `feat(piece): proof, challenges, addenda`.

### Task 10: Ownership — rotate, transfer_pending, revert

**Files:** `piece/src/core/ownership.rs`

**Interfaces — Produces:** `rotate_owner(sender: AccountId, receiver: AccountId, call: bool) -> Result<Effects>` (collection only; Settled; sender == owner; not listed; not Disputed; if `call` sets `transfer_pending{from: sender, seq}`), `resolve_transfer(revert: bool)` (collection only; requires pending; revert → owner ← from, seq+1; exempt from listed/disputed blocks; clears pending), and a rule enforced in every owner-gated method: `require_not_pending`.

- [ ] Tests: `transfer_blocked_before_settled` (T8), `rotate_only_from_collection`, `rotate_requires_sender_owner`, `transfer_call_receiver_cannot_withdraw_list_accept` (C3: every owner method fails while pending), `transfer_call_revert_cannot_be_blocked`, `consents_and_listing_cleared_on_rotation`.
- [ ] FAIL → implement → PASS → commit `feat(piece): ownership rotation and transfer_pending`.

### Task 11: Model-based fuzzer (invariants I1–I6)

**Files:** `piece/tests/model.rs`

**Interfaces — Consumes:** all core methods above. Produces nothing for later tasks.

- [ ] Write the model: proptest `Strategy` generating `Vec<Op>` (len 1..200) where `Op` covers every action in DESIGN §9.2 plus `PromiseOutcome { slot, ok }` and `AdvanceTime(ns)` and `PlainTransferIn(amount)`. A `World` holds `PieceCore`, a simulated NEAR/FT balance ledger, an in-flight promise queue (delivered in random order), and actor accounts {artist, client, buyer1, buyer2, arbitrator, fallback, stranger, collection}. Each op is applied with random actor and random attached deposit (0, 1 yocto, exact, exact±1).
- [ ] Invariants after every op: I1 (ledger ≥ liabilities; FT and NEAR variants), I2, I3, I4 (op rejected ⇒ state byte-identical, compare borsh), I5 (after `buy`, sum of previous owner's slots == pre-sale slots + sale credit), I6 (only owner succeeds at owner ops; none while pending).
- [ ] Run `PROPTEST_CASES=100000 cargo test -p piece --release --test model`; expected: PASS. Shrunk failures are fixed in the owning task's file with a regression unit test named `regression_<short>`.
- [ ] Commit `test(piece): model-based fuzzer for I1–I6`.

### Task 12: Piece contract wrapper

**Files:** `piece/src/contract.rs`

**Interfaces — Produces (on-chain ABI):** `init(collection, mode, artist, terms, capture_pubkey)` (#[init], callable once, predecessor == collection), all core methods as `#[payable]` near methods with `assert_one_yocto` where gated, `ft_on_transfer(sender_id, amount, msg) -> PromiseOrValue<U128>` (first line: `require!(predecessor == currency token)` else return `amount`; msg = `{"action":"fund"|"buy"|"pay_income", ...}`), `on_transfer_result(slot, amount)` (#[private] callback using `is_promise_success()`), views: `piece_info()`, `terms()`, `accounting()`, `proof_page(from, limit)`, `listing()`, `nft_item_info()` (sharded-item draft fields).

Storage rule: after each mutating call, `require!(env::storage_usage() * storage_byte_cost() <= near_balance - near_liabilities)`; growing methods take a deposit covering `delta_bytes × byte_cost` and refund excess.

- [ ] Unit tests (near-sdk test env): `ft_on_transfer_rejects_wrong_predecessor` (T14), `near_payable_rejected_on_ft_piece`, `ft_rejected_on_near_piece`, `every_gated_method_requires_one_yocto` (table-driven over method list), `init_only_once_only_collection`.
- [ ] FAIL → implement → PASS; run `scripts/build.sh` → size ≤ 300 KB.
- [ ] Commit `feat(piece): near contract wrapper`.

### Task 13: Collection — factory, NEP-171 index, attestation, governance

**Files:** `collection/src/{lib,nft,factory,attest}.rs`, `publisher/src/lib.rs`

**Interfaces — Produces:** `new(piece_code_hash: [u8;32], governance: AccountId, currencies: Vec<AccountId>, network: String)`, `create_piece(mode, terms: Option<Terms>, capture_pubkey) -> Promise` (payable; deposit ≥ `piece_creation_cost()` view; batch: create `p<N>`, transfer, `use_global_contract(hash)`, `init`, and for FT `storage_deposit` on token; callback `on_piece_created(n, payer, deposit)` records index or refunds), NEP-171: `nft_transfer`, `nft_transfer_call` (min prepaid gas `MIN_TRANSFER_CALL_GAS`), `nft_resolve_transfer`, `nft_token`, NEP-181 enumeration, NEP-177 `nft_metadata`, `on_rotated(token_id, owner, seq)` (predecessor must be exactly `p<token_id>.<self>`; seq must be higher), `sync_owner(token_id) -> Promise`, `attest(token_id, msg: ReportMessage, sig, key_id) -> Promise` (`env::ed25519_verify` against key `key_id`, key not revoked, `msg.network` matches, `msg.piece_id` matches token; then `piece.record_attestation`), governance: `propose_key(pk) → add after 72h`, `activate_key(id)`, `revoke_key(id)` (immediate), cap 8.

- [ ] Unit tests: `on_rotated_rejects_non_piece_predecessor`, `on_rotated_ignores_stale_seq`, `attest_rejects_revoked_key`, `attest_rejects_wrong_piece_or_network`, `pending_key_not_yet_valid`, `governance_cannot_call_rotate`.
- [ ] FAIL → implement → PASS → commit `feat(collection): factory, index, attestation`.

### Task 14: Sandbox integration suite

**Files:** `tests/src/{setup,commission,resale,transfer,payout_race,security,deploy}.rs`, `mock-ft/src/lib.rs`, `evil-receiver/src/lib.rs`

**Interfaces — Consumes:** ABIs from Tasks 12–13. `setup.rs` produces `async fn world() -> World` (sandbox, publisher publishes piece wasm globally, collection deployed and keys deleted, mock-ft with registration/blacklist/pause, accounts).

- [ ] Tests (each a `#[tokio::test]`):
  - commission: happy path NEAR + FT; revision; refund; full dispute ladder each stage; standalone.
  - **payout_race** (track requirement): `income_promise_lands_before_buy`, `income_lands_after_buy`, `claim_in_flight_during_buy`, `withdraw_then_list_then_sold_then_claim_fails_restores_to_seller`.
  - transfer: `transfer_call_receiver_cannot_drain` (evil-receiver tries withdraw/list/accept then returns true → reverted, balances unchanged), `transfer_call_revert_cannot_be_blocked`, `receiver_out_of_gas_reverts`, `nft_transfer_fails_visibly_when_piece_refuses`, `index_resync_after_failed_notify`, `nft_transfer_event_emitted_on_buy`.
  - security: `claim_to_unregistered_ft_restores_credit_min_gas_zero_headroom` (Review Focus 1), `usdc_blacklisted_creditor_can_claim_to_other`, `ft_buy_when_seller_credit_new_on_min_reserve`, `create_piece_failure_refunds_deposit`, `failed_near_transfer_invariant_converges`.
  - deploy: `collection_has_no_access_keys`, `piece_has_no_access_keys`, `piece_code_hash_matches`.
- [ ] Run `cargo test -p tests -- --test-threads=4`; expected all PASS.
- [ ] Commit `test: sandbox integration suite`.

### Task 15: Testnet deploy script + soak harness

**Files:** `scripts/deploy-testnet.sh`, `tests/soak/` (Rust bin using near-api against testnet)

- [ ] Script: build reproducible → publish global → create `soulprint-v1.<owner>.testnet` → deploy + init collection → delete all access keys → assert `view_access_key_list` empty → print code hashes.
- [ ] Soak bin: N=20 random commissions over 24h using funded test accounts; at end reconcile every piece's `accounting()` against events (fetched via RPC) — mismatch = non-zero exit.
- [ ] Run once (≥ 1h shortened mode for verification); commit `chore: testnet deploy and soak`.

---

## Self-review notes
- Spec coverage: §6.1 table → Tasks 7, 10, 13; §6.2 piece/collection → 3–10, 12–13; §7 T1–T15 → named tests across 5–14; §8 I1–I6 → Task 11; §9 items 1–3, 6–7 → Tasks 1, 11–15; items 4–5 → Plans 2–3; §13 spikes 1, 2, 5 → Task 0 (3, 4 → Plan 2).
- Every finding in `critique/security.md` maps to a named test (C1 → deploy tests + `rotate_only_from_collection`; C2 → T14 tests; C3 → Task 10/14; H1–H7, M1–M8, L1–L8 → named above; L9 documented in README task in Plan 3).
