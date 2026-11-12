# Submission checklist (deadline 14 Nov 2026 23:59 UTC)

- [ ] Public repository — created PRIVATE at github.com/RomarioKavin1/soulprint (MIT); Romario flips it public
- [ ] README matches behaviour (re-read after the last change; deployed code hashes filled in)
- [ ] Testnet deploy (Plan 1 Task 15): tool ready and dry-run tested (docs/testnet-deploy.md). Owner account soulprint-owner-12f173.testnet exists (key in ~/.near-credentials/testnet) with 12 NEAR; it needs ≈ 56 (≈ 67 with demo accounts), then `cargo run -q -p soulprint-deploy -- --owner <you>.testnet --demo-accounts --smoke`; fill the README hashes row
- [ ] Demo rehearsed end to end on testnet; timings recorded in docs/demo-script.md
- [ ] Demo video (≤ 3 min) following docs/demo-script.md
- [ ] Hackathon form: track 10 "NFTs That Do Something"; secondary track decision (Privacy & Private AI?)
- [ ] Spikes recorded: S2 (wallet sign-in / delegate signing), S3 (5 real recordings → thresholds), S4 (OCR on photos)
- [ ] Final full suite: `make test && make e2e`
