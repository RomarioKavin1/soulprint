# Submission checklist (deadline 14 Nov 2026 23:59 UTC)

- [ ] Public repository — created PRIVATE at github.com/RomarioKavin1/soulprint (MIT); Romario flips it public
- [ ] README matches behaviour (re-read after the last change; deployed code hashes filled in)
- [x] Testnet deploy (Plan 1 Task 15): soulprint-v1.soulprint-owner-12f173.testnet, 0 keys verified, hashes in README; 1 h soak run 12 Nov (see docs/testnet-deploy.md)
- [x] Deployed: web https://manmade-seven.vercel.app (Vercel), services on OCI behind a quick tunnel (docs/deploy.md)
- [x] Full live E2E against testnet through the deployed services: 12/12 (14 Nov); every route on the live site 200 at 1440 and 390, no console errors, copy lint clean
- [ ] Demo rehearsed end to end; timings noted in docs/demo-script.md
- [ ] Demo video (≤ 3 min) following docs/demo-script.md (live part as visitor; making/selling on the local demo)
- [ ] Hackathon form: track 10 "NFTs That Do Something"; secondary track decision (Privacy & Private AI?)
- [ ] Spikes recorded: S2 (wallet sign-in / delegate signing), S3 (5 real recordings → thresholds), S4 (OCR on photos)
- [x] Final full suite: `make test && make e2e` (12 Nov, plus the E2E against testnet 10/10)
- [ ] Domain: manmade.works (bought 13 Nov) — point it at the public deployment of the web app once there is one; say "manmade dot works" in the video
