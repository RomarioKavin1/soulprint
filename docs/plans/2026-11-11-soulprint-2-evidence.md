# Soulprint Evidence & Capture Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture signed, hash-chained process frames (phone PWA and browser screen capture), anchor them on-chain, compute honest evidence (coverage, largest jump, active time, live challenges), and produce a signed report the collection contract accepts.

**Architecture:** A shared TypeScript package (`@soulprint/proof`) holds the frame-chain, signing and borsh encoding used by both the browser capture code and the Node evidence service, pinned to the Rust test vectors from Plan 1 Task 2. The evidence service (Node + Fastify) verifies frame batches, stores encrypted frames, computes metrics with sharp, detects challenges with tesseract.js, and signs `ReportMessage`.

**Tech Stack:** Node 22, TypeScript 5.x, pnpm workspaces, @noble/ed25519, @noble/hashes, borsh (js), sharp, tesseract.js, Fastify, Postgres 16 (frames metadata), S3-compatible blob store (MinIO locally), vitest.

**Spec:** `../../DESIGN.md` §5, §6.3. Depends on Plan 1 Task 2 test vectors (`contracts/common/test-vectors/*.json`) and Plan 1 Tasks 9, 12, 13 ABIs (`anchor`, `challenge`, `deliver`, `collection.attest`).

## Global Constraints
- Repo: `soulprint/packages/proof`, `soulprint/services/evidence`, capture UI lives in Plan 3's web app but uses `@soulprint/proof`.
- Signing bytes must equal the Rust vectors byte-for-byte (`report-v1.json`, `anchor-v1.json`, genesis).
- Capture key: ed25519, generated per piece per device in the browser, private key stored in IndexedDB, non-extractable where WebCrypto Ed25519 is available, else @noble in memory and IndexedDB-encrypted with a passphrase-derived key.
- Frame: JPEG quality 85, long edge 1600 px; frame hash = sha256(JPEG bytes); chain link = sha256(prev_link ‖ frame_hash ‖ u32_le(index) ‖ u64_le(device_ts_ms)); link₀ prev = genesis.
- Anchor cadence: every 20 frames or 30 minutes, whichever first.
- E2 thresholds (versioned `thresholds-v1`): coverage ≥ 0.80, largest jump ≤ 0.10, final-file perceptual match ≥ 0.95 SSIM vs last frame (after crop/align).
- Challenge: 6-character code from an unambiguous alphabet (no 0/O/1/I/L), shown to artist; must appear in a frame within 10 minutes; detection = OCR confidence ≥ 70 on the code.
- Hours shown in bands: <5h, 5–10h, 10–20h, 20–30h, 30–50h, 50h+.
- Frames reviewed by the artist before upload (browser capture): unreviewed frames are never sent.

## Review Focus
1. **Phone pointed at a tablet with glare/moire** — coverage must not collapse because of lighting changes; test `coverage_robust_to_brightness_shift` (Task 4) with ±20% brightness synthetic frames.
2. **Artist pauses for days, device clock changes timezone** — chain must stay valid; device timestamps only monotonic within a session, anchors bound time; test `timezone_change_does_not_break_chain` (Task 2).
3. **Upload interrupted mid-batch / duplicated batch** — idempotent ingest by (piece, index); test `duplicate_and_partial_batches_idempotent` (Task 3).
4. **Canvas resized or cropped mid-process** — coverage computed after aligning to final aspect; test `coverage_handles_canvas_resize` (Task 4).
5. **Challenge code partially occluded / handwritten** — OCR misses must yield "inconclusive", never "failed"; test `ocr_miss_is_inconclusive` (Task 5).


## v2.2 Amendments — READ FIRST (override task text below)

Spec `DESIGN.md` §16 is binding (A26–A28, A33, A35–A38). ★ = demo path: Tasks 1, 2, 3, 4, 5, 6.

- **Global Constraints:** chain linked **at capture**; every frame uploaded encrypted immediately; review controls only visibility (A27). Remove the "unreviewed frames are never sent" rule. Remove fixed E2 thresholds and SSIM — thresholds come from Spike S3 (A37). Remove E1 (A32). Keys: API takes `Signer { publicKey: Uint8Array; sign(bytes): Promise<Uint8Array> }`; WebCrypto Ed25519 non-extractable when supported, else @noble with an IndexedDB-wrapped key; keystore keyed by public key (the key exists before the piece). `pieceId` = full account id everywhere (A33).
- **Task 1 ★:** consume `contracts/common/test-vectors/*.json` and `contracts/abi/` fixtures; add `batchMessage`, `Signer`; anchor/head semantics `head = link[count-1]`. Tests add `matches_rust_batch_vector`.
- **Task 2 ★:** capture links every frame at capture; `discard(ids)` deletes images, keeps hashes (test `discard_keeps_hash_drops_image`); session ids on frames; clock-set-backwards test replaces the timezone test (`clock_set_backwards_rejected_within_session`); upload status/retry exposed for UI. Add PWA bits needed for unattended phone capture: Screen Wake Lock, visibility handling (test `capture_pauses_and_resumes_on_visibility`).
- **Task 3 ★:** batch auth = capture-key signature over `BatchMessage` (A27); the service anchors using **its own sender account** (A35), not the relayer; forced final anchor endpoint `POST /pieces/:id/anchor/final` used before deliver. Add endpoints: final/source file upload (artist), story (text/audio), brief + references (artist & client, NEP-413 auth), visibility (approve for client / publish), client progress read (approved frames, decrypted server-side for authorised viewers). Tests per endpoint for auth.
- **Task 3 also (A48):** `POST/GET /pieces/:id/messages` (NEP-413 auth, artist + owner only); `issue_challenge` is signed by the issuer's own wallet in the web app, and `issuedAt` = block timestamp of that receipt.
- **Task 4 ★:** Spike S3 first (ask Romario now for 5 real process recordings — the only human dependency in this plan); implement A37/A38 with streaming input; output also includes per-cell coverage map, per-frame change series, span days. Tests updated: `blank_background_does_not_lower_coverage`, `exposure_normalisation_handles_brightness_shift`, `phone_angle_final_match_loose_check`.
- **Task 5 ★:** challenge flow per A28 (issue → artist ack signed by capture key → 10-min window); results only in the report.
- **Task 6 ★:** `report_hash` = sha256(JCS(public report)) (A36); E0 uses zero anchor head/count; the service submits `collection.attest` from its sender account; tests add `report_hash_recomputable_from_public_report`.

---

### Task 1: `@soulprint/proof` — chain, signing, borsh, vectors
**Files:** `packages/proof/src/{chain,messages,keys}.ts`, tests `packages/proof/test/*.test.ts`
**Produces:** `genesis(pieceId: string, pk: Uint8Array): Uint8Array`; `linkHash(prev, frameHash, index, deviceTsMs): Uint8Array`; `anchorMessage(pieceId, head, count): Uint8Array`; `reportMessage(r: ReportFields): Uint8Array`; `signAnchor(sk, …)`, `verifyChain(frames: FrameMeta[], genesis): {ok: boolean, brokenAt?: number}`.
- [ ] Tests: `matches_rust_report_vector`, `matches_rust_anchor_vector`, `matches_rust_genesis_vector`, `verify_chain_detects_reorder_drop_insert_tamper`.
- [ ] FAIL → implement → PASS → commit `feat(proof): chain and signing`.

### Task 2: Capture core (browser, framework-agnostic)
**Files:** `packages/proof/src/capture/{session,queue,screen,camera}.ts`
**Produces:** `class CaptureSession { constructor(pieceId, keystore, uploader); start(source: 'screen'|'camera', opts); stop(); captureNow(); pendingReview(): Frame[]; approve(ids); discard(ids) }`; offline queue in IndexedDB; `screen` uses `getDisplayMedia({video:{displaySurface:'window'}})`; `camera` uses `getUserMedia` rear camera; interval default 60s (screen) / 120s (camera).
- [ ] Tests (vitest + fake-indexeddb + mocked media): `frames_chain_in_order_across_restart`, `discarded_frames_never_uploaded_but_chain_skips_cleanly` (discarded frames are excluded *before* linking — chain built over approved frames only), `offline_queue_flushes_in_order`, `timezone_change_does_not_break_chain`.
- [ ] FAIL → implement → PASS → commit `feat(proof): capture session`.

### Task 3: Evidence service ingest + anchoring
**Files:** `services/evidence/src/{server,ingest,store,anchor}.ts`, `db/migrations/001_frames.sql`
**Produces:** `POST /pieces/:id/frames` (batch `{index, prevLink, frameHash, deviceTs, sig?, jpeg}`), verifies against on-chain `capture_pubkey` + genesis via RPC view `piece_info`; rejects frame hashes seen on another piece; encrypts JPEG (AES-256-GCM, per-piece data key wrapped by service KMS key) to blob store; `POST /pieces/:id/anchor` relays a signed anchor to `piece.anchor` via relayer (Plan 3) or returns the tx for the client to sign.
- [ ] Tests: `rejects_bad_signature`, `rejects_chain_break`, `rejects_frame_reused_from_other_piece`, `duplicate_and_partial_batches_idempotent`, `anchor_relay_builds_correct_args`.
- [ ] FAIL → implement → PASS → commit `feat(evidence): ingest and anchoring`.

### Task 4: Metrics — coverage, largest jump, active time, final match (Spike S3 folded in)
**Files:** `services/evidence/src/metrics/{align,coverage,activity,finalMatch}.ts`, fixtures `services/evidence/fixtures/`
**Produces:** `computeMetrics(frames: Buffer[], finalFile: Buffer): {coverage: number, largestJump: number, activeMs: number, sessions: number, finalSsim: number}`. Algorithm: align every frame to the final image (resize to 256px on long edge, ORB-free: center-crop to final aspect), grid 32×32 cells; a cell is "built" when its mean abs difference to the final drops below τ=12/255 and stays; coverage = share of cells whose first "built" frame index > 0 and that changed gradually (≤ 3 cells' worth of change per frame in their neighbourhood); largest jump = max share of cells changing state between consecutive frames; active = sum of intervals where ≥ 1% of cells changed.
- [ ] **Spike S3 first:** run on 5 real process recordings (ask Romario for 5 short sessions or use public CC-licensed timelapses) + 2 simulated "trace over projected image" sequences; record the metric values in `docs/spike-results.md`; adjust `thresholds-v1` only if real recordings fail E2.
- [ ] Tests: `full_image_pasted_in_one_frame_gives_jump_near_1`, `gradual_painting_gives_high_coverage`, `coverage_robust_to_brightness_shift`, `coverage_handles_canvas_resize`, `final_mismatch_detected`.
- [ ] FAIL → implement → PASS → commit `feat(evidence): process metrics`.

### Task 5: Live challenges (Spike S4 folded in)
**Files:** `services/evidence/src/challenge.ts`
**Produces:** `POST /pieces/:id/challenges` (issuer signs NEP-413 message; service generates code, stores sha256(code‖salt) and calls/returns `piece.challenge(nonce_hash)`), `GET /pieces/:id/challenges/:cid` (artist sees code), `evaluateChallenge(frames, code, issuedAt): 'passed'|'inconclusive'|'expired'` over frames with deviceTs and anchor-bound time in [issuedAt, issuedAt+10min].
- [ ] Spike S4: OCR reliability on 20 phone-of-tablet and 20 screen frames with the code written by hand and typed; record pass rates in `docs/spike-results.md`; if < 80% for handwritten, also accept "code typed as a text layer" guidance in UI copy.
- [ ] Tests: `typed_code_detected`, `ocr_miss_is_inconclusive`, `late_frame_expired`, `code_never_exposed_to_issuer_before_eval`.
- [ ] FAIL → implement → PASS → commit `feat(evidence): live challenges`.

### Task 6: Report, signing, attestation
**Files:** `services/evidence/src/report.ts`, `services/evidence/src/keys.ts`
**Produces:** `buildReport(pieceId): {public: PublicReport, private: PrivateReport, level: 0|1|2|3, reportHash}`; `signReport(...) -> {msg: ReportFields, sig, keyId}`; `POST /pieces/:id/report` → returns everything the artist passes to `deliver(final_file_hash, report_hash)`; `POST /pieces/:id/attest` submits `collection.attest` via relayer after `Delivered`. Level rules exactly as DESIGN §5. Report JSON includes `thresholds: "thresholds-v1"` and `verifier: "server-not-TEE"`.
- [ ] Tests: `level_rules_table` (each level boundary), `report_hash_is_sha256_of_canonical_json`, `signature_verifies_with_rust_vector_layout`, `level_never_above_evidence`.
- [ ] Sandbox cross-check (with Plan 1 World): `attest_accepts_service_signature` and `attest_rejects_level_tamper`.
- [ ] FAIL → implement → PASS → commit `feat(evidence): signed reports and attestation`.
