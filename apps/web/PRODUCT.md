# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: visitors and collectors.** People browsing real, human-made art and how it was made. They look through the gallery, open a piece, follow its making frame by frame, read the artist's story, and may tip the artist or collect the piece. Most arrive signed out.
- **Artists.** They record their process (screen or camera) in the studio, finish a piece, publish its page, optionally offer it to collectors, and answer readers' questions. Some also take commissions.
- **Readers / raters.** Signed-in people who ask questions about a record ("could this have been made with AI?") and rate other people's questions.
- **Commission clients, arbitrators, shops** (secondary): pay into a commissioned piece, review, resolve disputes, pay licence income.
- Hackathon judges (NEAR, track "NFTs That Do Something", development closes 14 Nov 2026 23:59 UTC) will see it through a 3-minute demo.

## Product Purpose

Soulprint protects the soul of real art without being anti-AI: artists show how a work was made, and the record states exactly what it shows — evidence, never "proof", never "proven not AI". Success: a visitor can see a piece, its making and its record at a glance, trust the wording, and act (tip, collect) without friction.

## Positioning

Every artwork is its own NEAR account that carries its own making: signed frames anchored on-chain while it was made, a signed report with an evidence level (E0 Declared, E2 Recorded while made, E3 + passed live checks), the rights grant, any income, and its sale history. Anyone can recompute the record's fingerprint in the browser. Resales pay the artist a royalty.

## Operating Context

- Routes: `/` landing (the idea, then "Enter the gallery"), `/gallery` the showcase (sort, filters, search; every view is a URL), `/a/<account>` artist page, `/p/<piece>` piece page (making timeline, facts, reader questions, collect/tip, rights, verify on-chain), `/notes` reader questions, `/studio` + `/studio/new` + `/studio/<piece>` artist workspace (record, review frames, finish, publish, sell), `/capture/<piece>` phone capture, `/c/<piece>` commission room, `/vault/<piece>` holder vault, `/buy/<piece>`, `/pay/<piece>`, `/limits`.
- Local demo signs in with demo accounts (`?as=` / "Signed in as" menu); testnet uses a wallet.
- Data: chain views (piece accounts, collection), evidence service (frames, reports, gallery, reader questions), indexer (history).

## Capabilities and Constraints

- Next.js app router, Tailwind v4, fonts via next/font. Existing tests (Playwright E2E, copy lint) rely on `data-testid`s, labels and some visible strings; behaviour must not change.
- Copy rule (enforced by a test): creator/client screens never show "NFT", "mint", "gas" or "wallet".
- Never claim "proven not AI"; reader questions never call a piece or person fake; the price of a commission is never shown publicly.
- Evidence wording comes from `lib/wording.ts` (DESIGN §5); do not alter the sentences.

## Brand Commitments

- Name: Soulprint. Owner's stance: "AI is useful but the soul of real pictures and real art must be protected" — aid real art, not anti-AI.
- Owner reference (binding direction, 13 Nov): an artsy, museum-like frontend in the spirit of objectandarchive.com, with **framed artworks** in the gallery, using **public-domain classic art** (paintings, sculpture) in the UI.

## Evidence on Hand

- No real recorded artworks yet (test pieces are synthetic patterns; all at E0). Owner will record real work.
- Classic public-domain artworks may fill the gallery as **examples** until real pieces exist (owner's choice, 13 Nov). They must be labelled as examples with title, artist, year and source, and never shown with a Soulprint record, level, price or collect button — they were not recorded on Soulprint.
- No testimonials, users, sales figures or press exist; do not invent any.

## Product Principles

1. The artwork leads; the interface recedes.
2. Say exactly what the record shows — nothing more, never a verdict.
3. Questions about a record are rated, not shouted.
4. Everything visible is checkable: the chain is the source of truth.
5. Artists are paid again on every resale.

## Accessibility & Inclusion

Readable contrast on all text over imagery; keyboard-usable gallery and timeline; alt text for every artwork (title, artist); respect reduced motion.
