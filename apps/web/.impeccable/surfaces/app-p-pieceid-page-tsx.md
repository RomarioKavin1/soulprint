---
version: 1
slug: "app-p-pieceid-page-tsx"
primary_target: "app/p/[pieceId]/page.tsx"
related_targets: []
---

# Piece page (/p/<piece>)

Scope: the public page of one piece. Mode: Experience (the work leads), with a working record beside it.
Audience: visitors and collectors first (most signed out), readers, judges in a 3-minute demo.
Job: see the work and its making first; then the record, provenance, questions, rights; act (collect, tip) without shop energy.
Owner answers (13 Nov): first job "The work and its making (Recommended)"; fold away "On-chain verification details" and "Measurement notes"; feels wrong if it "Looks like an online shop" or "The art feels small".
Constraints: all testids and behaviour kept; wording from lib/wording.ts; never "proven not AI"; commission price never shown.

## Direction contract

THESIS: A museum collection's object record. The work hangs large and alone on the wall; beside it one record, read in tabs, holds everything known about the piece. Refuses the default stack of equal white boxes under a small picture, and refuses the shop's price-first product card.
OWN-WORLD: Manmade's world unchanged: warm-white plaster and damask wall, photographed cassetta frame, printed label under the work, Cormorant titles, Cinzel tab labels with an ultramarine underline for the open tab, Spectral text, ultramarine only for the decisive action and the level sentence. The record column has no card chrome: it is wall text, ruled by hairlines.
STORY: The visitor sees the work at full size, reads its title, artist and the one sentence of what its record shows (and why it is at that level), scrubs the making, which swaps the framed picture on the wall to that frame, then opens the record, provenance, questions or rights as needed, and can collect or tip from the same column.
FIRST VIEWPORT: Desktop 1440: left ~58% the framed work, as large as the wall allows (sized from its proportions, never letterboxed), sticky as the record scrolls; label under it. Right column, no eyebrow: title at display size, "by artist · piece N", the level sentence in italic ultramarine, level chip, the why-line; then one line of status and one row of actions between hairlines — "Collect · price" and "Tip the artist", whose amount field opens on demand; signed out, both lead to sign-in (fixed place, above the tabs, because tab panels vary in length); then the tab row (The making · The record · Provenance · Questions · Rights) with The making open: story, frame strip, scrubber, caption. Phone: work first, full width; then the same column.
FORM: The object record (dealt lead of three; my ranked list position 4). seed:eabc035223312d0f. Raised from the declined passport challenger: Provenance is one dated ledger of everything that happened to the piece (anchored making, created, listed, sold, resold). Kept from the declined detector challenger: picking a frame isolates it on the wall (the label takes its frame number and date; on narrow screens the picked frame also shows where it was picked). Signature interaction: scrubbing the making re-hangs the picture on the wall; "Back to the finished work" returns it. Motion: the new picture fades in over the one it replaces, picture only, none under reduced motion. The timeline is a printed hairline with a tick per public frame and an ink marker.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
