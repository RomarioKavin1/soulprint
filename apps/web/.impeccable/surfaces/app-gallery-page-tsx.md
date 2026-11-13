---
version: 1
slug: "app-gallery-page-tsx"
primary_target: "app/gallery/page.tsx"
related_targets: ["app/a/[artist]/page.tsx"]
---

# Surface brief: the showcase (/gallery)

Mode: Operate (browse and find), in the Salon world (DESIGN.md). Audience: visitors and collectors. Task: find works by what their record shows, price and availability, artist or title; open one. Owner's brief: "an artistic product page with sorting features and all".
Content: published pieces (evidence /gallery) joined with the market (indexer /market: holder, listing, sales) plus the CC0 Met examples (toggle). Controls (owner's choice): sort (newest, oldest, price both ways, strongest record, title), filter by record level, availability (for sale, collected), search, artist, examples on/off. Every view is a URL.
Layout (owner's choice): an even framed grid — each work in its photographed frame inside an equal cell, printed label with title, artist, record level and price; examples labelled "Example", linking to The Met, never priced.
States: loading (server-rendered), no results (says which filter to loosen, one-click reset), feed unavailable (examples still shown, message), many results.

## Direction contract

THESIS: A catalogue room: the gallery as an even, orderly wall of framed works with a printed finding aid, not a webshop grid of cards.
OWN-WORLD: DESIGN.md (the Salon) unchanged.
STORY: Visitors narrow the wall to what they care about and open one work.
FIRST VIEWPORT: Title and result count on the wall, a single control bar (search, record, availability, artist, sort, examples) as a printed finding aid, then the framed grid four across at 1440.
FORM: precisely specified by the owner (even framed grid + controls); seed: none (pinned) — "artistic product page with sorting features and all", "Even framed grid".
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
