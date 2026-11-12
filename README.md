# Soulprint

**Commissioned art with the making on record.** Each commission is its own NEAR account
(`p<N>.<collection>`). That account holds the client's payment until they accept, the artist's
process record (signed frame by frame on the artist's device and anchored on-chain as they work,
plus live codes requested by the client), the rights grant the client bought, and any income the
piece earns afterwards. On acceptance the piece passes to the client; every resale pays the
artist a royalty.

NEAR hackathon, track 10 — *NFTs That Do Something* (NFTs as accounts).

> AI is useful, but the soul of real pictures and real art must be protected. Soulprint does not
> claim to detect AI. It records **how a piece was made** and states exactly what that record
> shows — evidence, not proof (see [Accepted limits](#accepted-limits)).

## What is in this repo

| Path | What |
|---|---|
| `contracts/` | Rust (near-sdk 5): `collection` (keyless, creates pieces from a global contract by hash, NEP-171 index), `piece` (escrow, milestones, review/revisions, dispute ladder, pull payments, holder income pool, resale with royalty, process anchors, live challenges, attestation), `common`, test harness and sandbox runner |
| `packages/proof` | Frame chain, signatures, Borsh messages shared by the browser and the services; browser capture session (IndexedDB, retry, wake lock) |
| `services/evidence` | Evidence service: encrypted frame store, anchoring, metrics (coverage, largest jump, active time, final match), live challenges with OCR, signed reports and attestation, holder vault with short-lived links |
| `services/indexer` | Follows the chain, keeps every `soulprint` event from the collection and its pieces, rebuilds balances, serves history |
| `services/relayer` | NEP-366 relayer with a strict allowlist: a signed action is submitted and paid for by the relayer (verified with a USDC payment). The web app does not route through it yet — that waits on which wallets sign delegate actions |
| `apps/web` | Next.js app: Studio (offer builder, capture, review, deliver), Commission room, Proof page, Vault, Buy, Pay, History |

## Run it locally (one command)

Requirements: Rust (see `contracts/rust-toolchain.toml`), `cargo-near`, Node ≥ 22, pnpm.

```sh
pnpm install
make demo        # sandbox chain + contracts, evidence (:8787), indexer (:8788), relayer (:8789), web on http://127.0.0.1:3000
```

`make demo` builds the contracts, starts a local NEAR sandbox with the collection deployed and
demo accounts funded (artist, client, buyer, shop, arbitrators), writes `config/networks.json`,
starts the evidence service, the indexer, the relayer and the web app. Use the **Signed in as** menu to switch people.
The sandbox uses seconds-scale timings (review windows, dispute stages) so every flow fits in a
demo.

Tests:

```sh
make test        # contracts (unit, sandbox, fuzzer), proof, evidence, indexer, relayer, web unit tests
make e2e         # Playwright against the running demo stack (start `make demo` first)
```

## How it works

1. **Offer.** The artist sets price, payment stages, deadline, review window, revisions,
   refusal deposit, arbitrators, rights and resale royalty. Creating the piece registers this
   device's recording key.
2. **Pay.** The client pays into the piece; the call carries the hash of the terms they were
   shown, so the terms cannot be swapped underneath them.
3. **Record.** The browser captures a frame every minute (screen) or two (camera), signs each
   frame on the device and chains it to the previous one. Frames upload encrypted; the service
   anchors chain heads on the piece. The client can ask for a live code; it must appear in the
   work within minutes.
4. **Deliver.** The service computes facts (coverage, largest jump, active time, sessions, final
   match, challenge results), signs a report bound to the piece, file, chain heads and level;
   the piece records it. The proof page states what the record shows (E0/E2/E3) in plain words.
5. **Accept, refuse or let it lapse.** Accepting releases payment and passes the piece and rights.
   Refusing posts a deposit and opens negotiation → arbitrator → fallback arbitrator → agreed split.
6. **Afterwards.** Licence income paid into the piece belongs to whoever holds it. Resale pays
   the seller, the artist's royalty, and moves the income pool to the buyer; the old holder's
   vault access ends.

## Transfer threat model

Goal: after a sale or transfer, the previous holder keeps nothing beyond what they were explicitly paid (`credits` created by the sale), plus any files they already downloaded (T6).

| # | Attack | Mitigation | Tests |
|---|---|---|---|
| T1 | Drain income pool before buyer's `buy` lands | no withdraw while listed; `expected_pool_min`; nonce | `withdraw_blocked_while_listed`, `buy_fails_if_pool_below_expected` |
| T2 | Income arrives mid-sale, seller claims it | income → pool; pool belongs to owner at `withdraw` time; `buy` single receipt | `income_before_and_after_buy_goes_to_buyer` |
| T3 | Failed withdraw/claim lands funds with the wrong party | in-flight slots; failure restores to the same creditor, never the pool | `failed_claim_restores_creditor_not_pool` (sandbox, unregistered FT payee, min gas) |
| T4 | Approval/delegate survives sale | no NEP-178; function-call keys can't act (1 yocto); consents bound to `rotation_seq` | `every_gated_method_requires_one_yocto`, `consents_and_listing_cleared_on_rotation` |
| T5 | Seller keeps vault access | sessions bound to `rotation_seq`; vault denied during `transfer_pending`; 5-min URLs (an in-flight URL may outlive a sale by ≤ 5 min — stated) | evidence service `old_holder_vault_denied_after_transfer` (also live E2E), `vault_denied_during_transfer_pending` |
| T6 | Seller already downloaded files | not preventable; the grant (which moves) governs legal use — documented | — |
| T7 | Rights narrowed before/after sale | terms hashed and pinned at `fund(expected_terms_hash)`; `terms_hash` immutable; widening only via holder-accepted addenda | `fund_rejects_changed_terms_hash`, `addendum_requires_holder` |
| T8 | Sell a commission position then claw back escrow | transfers blocked before Settled | `transfer_blocked_before_settled` |
| T9 | `nft_transfer_call` receiver drains then returns, or blocks the revert | `transfer_pending` freezes all owner actions; revert path exempt from listing/dispute blocks; min prepaid gas | `transfer_call_receiver_cannot_withdraw_list_accept`, `transfer_call_revert_cannot_be_blocked`, `receiver_out_of_gas_reverts` |
| T10 | Index lags or lies | piece is truth; seq-ordered updates from exact piece account; `sync_owner`; gating retries | `on_rotated_ignores_stale_seq`, `on_rotated_rejects_non_piece_predecessor`, `index_resync_after_failed_notify` |
| T11 | Storage griefing | live reserve; payable growing methods; caps | fuzz invariant `storage_covered`, `caps_capture_keys`, `caps_invites`, `caps_challenges_per_issuer`, `anchor_cap_enforced` |
| T12 | Admin/deployer moves pieces or funds | collection + pieces have zero access keys and no upgrade path; governance limited to verifier keys | `collection_created_keyless_in_one_tx`, `piece_has_no_access_keys_and_code_hash_matches` |
| T13 | Relist at higher price / swap listing | `buy(nonce, max_price)` | `buy_rejects_changed_nonce` |
| T14 | Spoofed FT payment (direct `ft_on_transfer` call) | predecessor == currency | `ft_on_transfer_rejects_wrong_predecessor` |
| T15 | Replay a strong report on a weak piece / self-assert level | domain-separated signed struct bound to piece, file, chain head, level | `attest_rejects_wrong_piece_or_network`, `attestation_report_hash_must_match`, `attest_rejects_level_tamper` |

The table is DESIGN §7; the test column names the tests as they exist in this repository
(`grep -r <name>` finds each one), and the fuzz invariants are in `contracts/piece/tests/model.rs`.

## Accepted limits

- Hand-tracing AI output can still pass.
- Downloaded files can't be recalled.
- After Settled, royalty can be bypassed with a plain `nft_transfer` plus off-chain payment.
- On-chain amounts are public (the proof page hides price, but escrow balances are visible on-chain).
- Residual trust: collection code hash, evidence-service key (until TEE), arbitrators.
- L9: a vault download link already issued can outlive a sale by at most 5 minutes.
- Device time is device-reported and only bounded by on-chain anchors.
- Evidence thresholds are provisional (`thresholds-v0-provisional`) until tuned on real process
  recordings.

## Residual trust

- **Contracts**: the collection and pieces have no access keys and no upgrade path; check the
  piece code hash below against a build of `contracts/piece`.
- **Evidence service**: signs reports with a key registered in the collection (rotatable,
  timelocked); it is a server, not a TEE. A withdrawn key turns its records back into "declared".
- **Arbitrators**: chosen in the terms by the artist and accepted by the client at payment.

## Deployed code hashes

Piece code hash = sha256 of `contracts/res/piece.wasm` (base64 as `collection_info` shows it; hex in
`config/networks.json` as `piece_code_sha256`). Collection code sha256 (hex):
`370a5017af9dd765ce1caf6654da98416d4502f59e5e67f17fbc9aceb5a32ede`.

| Network | Collection | Piece code hash | Genesis tx |
|---|---|---|---|
| sandbox (local, regenerated on each run) | `soulprint.test.near` | `u4gSGFBV2VfDZSzlSoviGaoEx/LJzy3VJFd/I/nJM4A=` | — |
| testnet | not deployed yet — see [docs/testnet-deploy.md](docs/testnet-deploy.md) | — | — |

## Licence

MIT — see [LICENSE](LICENSE).
