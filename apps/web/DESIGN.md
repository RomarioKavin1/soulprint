---
name: Manmade Salon
description: A salon hang of real art on a gallery-white wall; every work in a photographed period frame with a printed label that says exactly what its record shows.
colors:
  wall: "#f6f4ef"
  wall-deep: "#ece8e0"
  paper: "#ffffff"
  paper-2: "#efece6"
  ink: "#1a1814"
  ink-2: "#5b5650"
  ink-3: "#736d66"
  ink-hover: "#33302a"
  rule: "#e2ddd3"
  control-rule: "#d9d3c8"
  seal: "#23399a"
  accent-2: "#1a2b78"
  seal-2: "#a3261e"
  moss: "#2f6b3f"
  amber: "#8a5a0c"
  gilt: "#c9a24a"
  sight: "#1a1210"
  mat-linen: "#f1ede5"
typography:
  display:
    fontFamily: "Cormorant Garamond, 'Cormorant 72', Didot, serif"
    fontSize: "clamp(2.4rem, 3.4vw, 3.6rem)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.02em"
  hero:
    fontFamily: "Cormorant Garamond, 'Cormorant 72', Didot, serif"
    fontSize: "clamp(3rem, 6.2vw, 6rem)"
    fontWeight: 400
    lineHeight: 0.94
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Cormorant Garamond, 'Cormorant 72', Didot, serif"
    fontSize: "clamp(2.2rem, 4vw, 3.4rem)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Cormorant Garamond, 'Cormorant 72', Didot, serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
  piece-title:
    fontFamily: "Cormorant Garamond, 'Cormorant 72', Didot, serif"
    fontSize: "clamp(3rem, 5vw, 4.8rem)"
    fontWeight: 500
    lineHeight: 0.98
    letterSpacing: "-0.02em"
    fontFeature: "'kern', 'liga', 'lnum'"
  level-sentence:
    fontFamily: "Cormorant Garamond, 'Cormorant 72', Didot, serif"
    fontSize: "1.875rem"
    fontWeight: 500
    lineHeight: 1.2
  fact-figure:
    fontFamily: "Cormorant Garamond, 'Cormorant 72', Didot, serif"
    fontSize: "1.875rem"
    fontWeight: 500
    lineHeight: 1
    fontFeature: "'kern', 'liga', 'lnum'"
  body:
    fontFamily: "Spectral, Georgia, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "'kern', 'liga', 'onum'"
  label:
    fontFamily: "Cinzel, 'Trajan Pro', serif"
    fontSize: "0.72rem"
    fontWeight: 600
    letterSpacing: "0.2em"
  button:
    fontFamily: "Cinzel, 'Trajan Pro', serif"
    fontSize: "0.76rem"
    fontWeight: 600
    letterSpacing: "0.13em"
  tab:
    fontFamily: "Cinzel, 'Trajan Pro', serif"
    fontSize: "0.74rem"
    fontWeight: 600
    letterSpacing: "0.16em"
  plaque-title:
    fontFamily: "Cinzel, 'Trajan Pro', serif"
    fontSize: "0.72rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.1em"
  plaque-line:
    fontFamily: "Spectral, Georgia, serif"
    fontSize: "0.82rem"
    fontWeight: 400
    lineHeight: 1.3
  data:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
rounded:
  none: "0px"
  plate: "2px"
spacing:
  gutter: "16px"
  gutter-wide: "32px"
  sheet: "24px"
  sheet-wide: "32px"
  plaque-drop: "14px"
  hang-gap-x: "clamp(14px, 1.6vw, 26px)"
  hang-gap-y: "clamp(18px, 2vw, 28px)"
  bleed-inline: "clamp(16px, 3vw, 48px)"
  page-column: "1400px"
  room-gap: "clamp(96px, 12vw, 168px)"
  showcase-gap-x: "clamp(20px, 2.4vw, 36px)"
  showcase-gap-y: "clamp(36px, 3.6vw, 56px)"
  record-gap: "72px"
  record-gap-narrow: "48px"
components:
  button-seal:
    backgroundColor: "{colors.seal}"
    textColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.plate}"
    padding: "10px 16px"
  button-seal-hover:
    backgroundColor: "{colors.accent-2}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.plate}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.plate}"
    padding: "10px 16px"
  button-ghost-hover:
    backgroundColor: "{colors.paper}"
  sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "{spacing.sheet-wide}"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.plate}"
    padding: "8px 12px"
  plaque:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.plaque-title}"
    rounded: "{rounded.none}"
    padding: "8px 14px 9px"
  chip:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "4px 12px"
  chip-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.none}"
    padding: "4px 12px"
  wall-select:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.plate}"
    padding: "4px 26px 4px 10px"
  finding-aid:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "18px 20px"
  showcase-label:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.plaque-title}"
    rounded: "{rounded.none}"
    padding: "9px 12px 10px"
    width: "17rem"
  record-tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-3}"
    typography: "{typography.tab}"
    rounded: "{rounded.none}"
    padding: "4px 0 11px"
  record-tab-hover:
    textColor: "{colors.ink}"
  record-tab-selected:
    textColor: "{colors.seal}"
  making-thumb:
    backgroundColor: "{colors.paper-2}"
    rounded: "{rounded.none}"
---

# Design System: Manmade Salon

## Overview

**Creative North Star: "The Salon Hang"**

Manmade is one room: a gallery-white wall in even light, hung close with works in real period frames. Every work carries a flat printed label that states what its record shows and nothing more. The hang is a Paris Salon's, where pictures touch shoulders and sizes vary; the wall is a present-day museum's warm white, so the photographed frames and the pictures carry all the colour. What separates it from an online shop's white grid is the frame, the label and the hang, never the colour of the wall.

There are two surfaces and one ink. **The wall** (warm white) carries the art, the headlines and navigation. **The sheet** (pure white paper with a ruled edge and a soft shadow) carries facts, forms and reading. Both take the same near-black ink (`ink`, `ink-2`, `ink-3`) and the same `rule`; a sheet differs from the wall by one step of white, a 1px border and its shadow, so a component reads the same in either place. One accent, ultramarine, marks the decisive action and the few emphasised words.

The physical parts are photographs, not drawings. The frames are four empty cassetta frames from The Metropolitan Museum of Art (Open Access, CC0) cut into nine-slice plates with measured slices; sculpture is cut from its museum photograph and stands on its own base. Each raster ships with a provenance record next to it. Operate screens (studio, rooms, vault, pay) live in the same room and simply use more sheet and less wall.

The room has four ways of showing work. **The hang** is the close salon wall of mixed sizes (artist pages). **The showcase** (`/gallery`) is the catalogue room: an even wall of equal cells, every work framed, under a printed finding aid. **The landing** (`/`) opens on the one unframed, full-bleed picture in the system, a museum photograph of real paint seen close, then walks through four numbered rooms to a doorway into the gallery. **The object record** (`/p/<piece>`) is one work hung large and alone, with everything known about it set beside it as wall text ruled by hairlines and read in tabs; it is the one place facts leave the sheet.

**Key Characteristics:**
- One warm-white wall in even light: no wall colour, only the faint tone-on-tone damask over plaster.
- Photographed period frames as nine-slice border plates; four mouldings, one per work for life.
- Flat white wall labels with a ruled edge: Cinzel title, italic Spectral line, ultramarine level.
- White sheets with a 1px rule border and a soft warm-black shadow for every fact and form.
- Square forms; the only radius is 2px on controls.
- One authored interaction: a work steps forward and the wall behind it brightens.
- Pictures are sized from their own proportions, so every picture fills its frame.
- One full-bleed photograph of paint on the landing; everywhere else a picture is framed.
- One accent, ultramarine; gilt exists only in the photographed frames.
- A piece page is a museum object record: the work stays on the wall while a cardless, hairline-ruled record scrolls beside it.

## Colors

A light, warm palette: gallery white, near-black ink and one ultramarine accent. The frames and the pictures carry the colour; the interface stays out of their way.

### Primary
- **Ultramarine** (`seal`, hover `accent-2`): the painter's lapis blue and the only accent. The decisive button, the italic emphasis word in a headline, the evidence sentence on a piece page, the level line on a label, room numerals and level codes, the drawn quotation mark on sheets, the focus ring, text selection, input focus, caret and checkbox, the "Clear filters" link. On the piece page it also marks where the reader is: the open tab's lettering and 2px underline, the 2px outline of the picked making frame, and the "Back to the finished work" link.

### Secondary
- **Leaf Gilt** (`gilt`): the metal of the photographed frames, recorded for reference. It is not painted anywhere in the interface: no gilt lines, plates, borders or lettering.

### Tertiary
- **Refusal Red** (`seal-2`): error, refusal and destructive-action text. Errors stay red; they never take the accent.
- **Moss** (`moss`) and **Amber** (`amber`): confirmation and caution, as small text or a thin border, rare.

### Neutral
- **Gallery White** (`wall`): the wall, the body background of every route, and the scrim laid over the landing's paint so the lettering stays readable.
- **Wall Shade** (`wall-deep`): the root behind the wall (overscroll and the foot of the room).
- **Paper** (`paper`): sheets, wall labels, the finding aid, fields, and the lettering on filled buttons. Pure white, one step brighter than the wall.
- **Paper Shade** (`paper-2`): recessed wells (code blocks, bar tracks, thumbnails), state chips, and the room seen through the last doorway.
- **Ink** (`ink`, `ink-2`, `ink-3`): headline, reading and quiet text, the same on wall and paper. `ink` is also the plate of the ordinary primary button (`ink-hover` on hover).
- **Rule** (`rule`): the 1px line: sheet, label and finding-aid borders, the header rail, the footer line, quiet chips. **Control Rule** (`control-rule`) is the slightly darker border of fields and the wall select.
- **Sight** (`sight`) and **Linen Mat** (`mat-linen`): the dark sight edge inside a frame, and the mat used for prints and for making-frames shown in place of a finished image.

### Named Rules
**The One Ink Rule.** Text is `ink`, `ink-2` or `ink-3` and lines are `rule`, on the wall and on paper alike. There are no surface scopes and no light-on-dark variants to maintain; never hard-code a text colour.

**The Seal Is One Decision Rule.** The ultramarine seal button marks the one decisive action in a view (enter the gallery, start a piece, the committing step of a flow). Ordinary actions are near-black plates or ghosts.

**The Ultramarine Level Rule.** On a label, the only coloured line is the level or the word "Example", in ultramarine. Colour never grades a work; green, amber and red are for system state only.

**The Pictures Carry The Colour Rule.** Wall, paper and ink are neutral, and ultramarine is the single accent. Every other colour on a screen comes from a photographed frame or a picture. Gilt is never drawn.

## Typography

**Display face (13 Nov):** Cormorant Garamond replaced Bodoni Moda at the owner's choice ("A · Cormorant (Recommended)" from four rendered candidates, after "I dont like this font"). Titles set at 500 (600 for small display type on paper), always with lining figures (`lnum`) so numbers in facts and titles read evenly; body Spectral keeps old-style figures.

**Display Font:** Cormorant Garamond, optical-size axis on (fallback Cormorant 72, Didot, serif)
**Body Font:** Spectral, 300 to 600 with italics (fallback Georgia, serif)
**Label Font:** Cinzel, 400/600/700 (fallback Trajan Pro, serif)
**Data Font:** JetBrains Mono 400 (fallback ui-monospace, Menlo)

**Character:** High-contrast Didone for what is said aloud on the wall, inscriptional capitals for what is printed on plates and labels, and a quiet book serif with old-style figures for reading. Mono appears only for values a reader could check on-chain.

### Hierarchy
- **Hero** (400, clamp(3rem, 6.2vw, 6rem), line-height 0.94, -0.025em): the landing headline only, set over the scrim; one italic word in Ultramarine. It is the largest type in the system and appears once.
- **Display** (400, clamp(2.4rem, 3.4vw, 3.6rem), line-height 1, -0.02em): lettering painted on the wall. One word may be italic in Ultramarine. The header wordmark is the same face at 2rem to 2.4rem.
- **Headline** (400, clamp(2.2rem, 4vw, 3.4rem), line-height 1, -0.015em): page titles on the wall; the artist name runs up to 4.4rem and the gallery title to 4rem (the piece title has its own step, below). Landing room titles use the same size at line-height 1.05, under a roman numeral in display type (2.4rem, Ultramarine).
- **Piece title** (500, clamp(3rem, 5vw, 4.8rem), line-height 0.98, -0.02em, lining figures): the title of the one work on a piece page, set on the wall at the head of its record. Only the landing Hero is larger.
- **Level sentence** (500 italic, 1.875rem, line-height 1.2, Ultramarine, held to 30ch): the one sentence from the evidence wording table under the piece title and artist line. It is display type on the wall, so it does not take the paper weight.
- **Title** (600 on sheets, 1.875rem): section headings inside sheets.
- **Fact figure** (500, 1.875rem, line-height 1, lining figures): the figures of the piece record's ledger facts, set on the wall. The artist's words in The making use the same size in italic reading ink behind the drawn quotation mark.
- **Body** (400, 17px, line-height 1.55): reading text; wall paragraphs are held to 32 to 36ch, sheet text to about 62ch. A landing room's explanation is the one longer wall text: 1.06rem in reading ink, held to 60ch (the hero sentence to 38ch). Secondary text is 0.875rem, fine print 0.75rem.
- **Label** (Cinzel 600, 0.72rem, 0.2em, uppercase): field labels, definition terms, navigation. Buttons are 0.76rem at 0.13em; chips 0.7rem at 0.14em; record tabs 0.74rem at 0.16em.
- **Wall label** (Cinzel 700, 0.72rem, 0.1em uppercase title, two lines at most; Spectral italic 0.82rem line; Cinzel 600 0.7rem ultramarine level; Spectral 0.78rem note).
- **Data** (JetBrains Mono 400, 0.75rem, tabular figures): account names, fingerprints, hashes, codes.

### Named Rules
**The Heavier-On-Paper Rule.** Cormorant's hairlines break at small sizes on paper. Any display type inside a sheet is weight 600; weight 400 is for large lettering on the wall.

**The Capitals Are Printed Rule.** Cinzel is always uppercase, tracked 0.1em to 0.3em, and at or below 0.8rem. It is never used for sentences.

## Layout

**The One Edge Rule.** Every page shares one width and one gutter: `--page-max` 1680px, `--gutter` clamp(16px, 3vw, 48px), applied by the `page` utility to the header, `<main>` and the footer. Full-bleed sections (the landing hero, the last doorway) pad their content to `--edge`, so the logo, every page title, the hero copy and the hero's framed example all start or end on the same line at every width. Pages are left-aligned on that edge; nothing is centred in a narrower column except reading text capped by its measure. Every page's first block starts `page-top` (clamp(40px, 4.5vw, 64px)) below the header; only the landing hero sits flush. Titles come in three sizes only: `title-display` (gallery, artist, piece, limits), `title-page` (studio and working pages), `title-section` (headings inside sheets).

The wall is a tone-on-tone damask stencil (`public/salon/damask.svg`, warm brown at 7% with a white 50% highlight; owner asked for the patterned salon wall back) over faint lime plaster (`public/salon/wall/plaster.webp`, a seamless procedural 512px tile, ±3% around #f6f4ef), so the white reads as a papered wall, never as a blank screen.

The page column is 1400px wide with a 16px gutter (32px from 640px) and 112px of wall left under the content. The header is the rail: wordmark lower-left, navigation lower-right, and a 1px rule line running the full width beneath them.

**The hang** is the main layout. It is a wrapping, centred flex row with one centre line, tight gaps (14 to 26px across, 18 to 28px down), and four sizes set by height: small clamp(110px, 10.5vw, 160px), medium clamp(190px, 18vw, 290px), large clamp(230px, 23vw, 360px), extra clamp(260px, 30vw, 460px). Sizes follow a fixed rhythm (large, two small, medium, two small, large, medium ...), and two consecutive small works stack in one column. Sculpture and works taller than 1.45:1 never hang small. Lettering blocks (18 to 24rem wide, left-aligned) hang in line with the frames as if painted on the wall. A section may bleed wall to wall, past the page column, with clamp(16px, 3vw, 48px) of side padding; the landing hero and its last doorway do. The hang now serves artist pages, inside the page column.

Below the hang, sheets sit in a centred reading column (max-w-5xl, narrower for forms) with 48px between sheets and 96 to 128px of wall above the first.

**The object record** (`/p/<piece>`) is two columns from 1100px: the wall at 1.3fr and the record at 1fr (never under 400px), 72px apart, both starting at the top. The wall column is sticky 28px from the top, so the work stays hung while the record scrolls. The picture is sized by The Proportion Rule with `--h` min(62vh, 720px) and `--cap` taken from its own column by a container query: the column's width (100cqi) less the moulding on both sides and 8px, so the frame always fits its column and the picture is never letterboxed. The wall label sits under the frame as everywhere. The record column has no card: title, artist line, level sentence, level chip and the reasons for the level (held to 60ch); 26px below, one status line and one action row between two hairlines (18px above and below); 34px below that, the tab row on its own hairline; then the open panel, 24px under the tabs. Below 1100px it is one column, work first, 48px apart, the wall no longer sticky and `--h` min(64vh, 640px). When the artist keeps the frames private the frame holds a blank of min(52vw, 640px) by min(52vh, 480px) with the italic line saying so.

**Phones (to 640px):** works are sized by width, not height (large 76vw, medium 66vw, small 38vw side by side as a pair; a lone small work hangs centred at 66vw), frame mouldings thin to 6% of the width. On the piece page `--h` is 56vh and `--cap` is the column less the thinner moulding and 4px; the tab row wraps to two rows instead of scrolling, and ledger facts and provenance rows stack label over value. Below 1024px the welcome lettering moves ahead of the first work.

**The showcase** (`/gallery`) is the even wall. Title and result count sit on the wall, then the finding aid, then a grid of equal cells: `repeat(auto-fill, minmax(15.5rem, 1fr))`, four across at 1440px, gaps of 20 to 36px across and 36 to 56px down. Each cell reserves the same picture height (`--h`, clamp(170px, 15vw, 230px)) plus its moulding, and frames are bottom-aligned in that space so every label starts on one line per row. `--cap` (clamp(150px, 17.5vw, 260px)) is the widest a picture may hang in its cell. On phones the showcase is two columns with `--h` 150px, `--cap` calc(50vw - 46px) and gaps of 14px across, 28px down. Sculpture stands unframed in its cell, 30px taller than the pictures.

**The landing** (`/`) is a sequence. The hero bleeds wall to wall and fills the first screen under the rail (at least 640px tall): type in a 46rem column at the left, the paint clear at the right, and the whole painting framed small (clamp(120px, 13vw, 190px) tall) at bottom right with its label. To 760px the type sits at the top, the scrim runs top-down and the framed whole is 84px tall, still inside the first screen. Four rooms follow, each 96 to 168px below the last, alternating a two-column room (work and text, from 1024px) with a centred one; a room's framed work is clamp(260px, 30vw, 420px) tall and at most min(80vw, 560px) wide. The page ends at the last doorway, up to 1180px wide.

### Named Rules
**The Proportion Rule.** A picture is sized from its own aspect ratio, never forced into a box: `width: min(var(--cap), calc(var(--h) * var(--ar))); height: auto`. Each layout sets `--h` (the height a picture aims for) and `--cap` (the widest it may be); `--ar` is set inline when the proportions are known and read from the image on load when they are not (artists' previews). So a wide picture narrows to the cap and gets shorter, a tall one keeps the height, and the frame always closes on the picture with no bands. Until the proportions are known the picture hangs at `--h` with `object-fit: contain`.

**The One Unframed Painting Rule.** The landing hero is the only place a painting appears without a frame, and it earns that by being a close detail: the whole work hangs framed and labelled inside the same view, linked to its museum page. Sculpture stands without a frame everywhere because it is an object, not a picture.

## Elevation & Depth

Depth is physical and quiet. The room is lit evenly from above and the wall carries no gradient; objects cast soft warm-black shadows (ink, `rgba(26,24,20,…)`) straight down. Buttons, chips and fields are flat. There are no hard offset shadows, no coloured shadows and no glows; the one change in the wall is that it brightens behind an approached work.

### Shadow Vocabulary
- **Hung frame** (`0 18px 28px -16px rgba(26,24,20,0.45), 0 3px 6px -1px rgba(26,24,20,0.25)`): every framed work at rest.
- **Approached frame** (`0 28px 40px -18px rgba(26,24,20,0.5), 0 6px 10px -2px rgba(26,24,20,0.3)` with a 4px lift): hover or focus within.
- **Moulding depth** (`inset 0 6px 9px -4px rgba(0,0,0,0.5), inset 5px 0 8px -5px rgba(0,0,0,0.35)`): the frame shading the picture's top and left edges.
- **Sheet** (`0 1px 2px rgba(26,24,20,0.04), 0 12px 32px -20px rgba(26,24,20,0.25)`): white sheets, with their 1px rule border.
- **Label** (`0 1px 3px rgba(26,24,20,0.08)`): wall labels and showcase labels, with their 1px rule border.
- **Sculpture** (`drop-shadow(0 3px 2px rgba(26,24,20,0.35)) drop-shadow(0 12px 10px rgba(26,24,20,0.18))`): follows the cut-out's silhouette.
- **Finding aid** (`0 10px 28px -20px rgba(26,24,20,0.3)`): the white strip of controls; lighter than a sheet because it lies closer to the wall.
- **Doorway** (`inset 0 0 30px rgba(26,24,20,0.08), 0 18px 32px -18px rgba(26,24,20,0.4)`): the room seen through the last doorway is flat Paper Shade, faintly shaded at its edges; the casing casts down like a frame.
- **Paint scrim** (`linear-gradient(90deg, rgba(246,244,239,0.96) 0%, rgba(246,244,239,0.9) 34%, rgba(246,244,239,0.25) 60%, transparent 74%)` over `linear-gradient(0deg, rgba(246,244,239,0.7), transparent 22%)`; to 760px one top-down gradient from 0.96 through 0.9 at 48% and 0.15 at 70% to clear): Gallery White laid over the hero photograph. It lightens, it never darkens.

### Motion
- **Approach:** frame lifts 4px and a radial patch of white (90% at its centre) fades in behind it, brightening the wall, 500ms, `cubic-bezier(0.16, 1, 0.3, 1)`. Triggered by hover and by keyboard focus within.
- **Arrival:** each work comes up from 35% brightness once, 1100ms, staggered 60ms per work after 120ms.
- **Showcase arrival:** the same rise from the dark per cell, 900ms, staggered 40ms and capped at the twelfth cell so a long wall never waits. A showcase frame takes the 4px approach lift without the wall brightening.
- **Lean in:** as the landing scrolls through its first screen the hero paint scales to 1.08 and drifts down 2%, from an origin at 70% 30%. It is driven by scroll position, not time, and runs only where scroll-driven animation is supported.
- **Re-hang on the wall (piece page):** when a frame of the making is picked, the new picture fades in (opacity 0 to 1, 420ms, `cubic-bezier(0.16, 1, 0.3, 1)`) over the previous picture, which is kept beneath it until the fade ends. Only the picture changes; the frame, label and page do not move. Under reduced motion the swap is immediate and the previous picture is not kept.
- **Record controls:** tabs, making thumbnails and fold chevrons change colour, outline or angle in 160ms.
- **Re-hang:** while the showcase is fetching a new view the finding aid drops to 70% opacity over 200ms; nothing else moves.
- **Controls:** 200ms background, border and colour changes only.
- **Reduced motion:** no lift, no arrival, no lean in, no smooth scroll.

### Named Rules
**The One Light Rule.** Light is even and comes from above. Shadows fall straight down in warm black, inner shading sits on the top and left of a picture, and nothing is lit from below or from the side.

## Shapes

Everything is square. Sheets, labels, chips, frames and pictures have no radius; controls (buttons, fields, the wall select, the focus ring) take 2px, the softness of a cut plate. There are no pills and no circles.

Borders are either photographed or ruled. A frame is a photographed moulding drawn as a border image whose width is 8.5% of the work's height (minimum 12px; 6% of width on phones) with true corners and stretched sides; the stone-inlaid frame repeats its sides instead of stretching. Everything else is a 1px line: sheets, labels and the finding aid have a 1px `rule` border at their edge; fields and the wall select a 1px `control-rule` border; ghost buttons a 1px border (#cfc9be). On the piece record the same 1px `rule` line is used open, as a hairline above and below a row and never as a box: around the action row, under the tab row, between ledger facts and between provenance rows. The timeline's hairline and ticks are 1px in `ink-3`, and its marker is a rectangle, never a round knob.

A doorway casing is the same photographed moulding as a frame, drawn as a border image clamp(18px, 2.4vw, 32px) wide around an opening instead of a picture.

## Components

### Buttons
Small flat plates: Cinzel capitals, 2px corners, 10px by 16px, no shadow.
- **Seal:** ultramarine plate, white lettering. The decisive action.
- **Primary:** near-black plate (`ink`), white lettering. Ordinary committing actions.
- **Ghost:** transparent with a 1px border (#cfc9be) and ink lettering; on hover the border turns ink and the plate fills white.
- **Hover / Focus / Disabled:** hover deepens the plate (seal to `accent-2`, primary to `ink-hover`); focus is a 2px ultramarine outline offset 3px, the same everywhere; disabled is 45% opacity.

### Chips
- **Style:** a small printed state label, square, Paper Shade with ink capitals.
- **Quiet:** transparent with an inset 1px rule and `ink-2` capitals, for secondary states.

### Cards / Containers (the sheet)
- **Corner Style:** square.
- **Background:** Paper, flat.
- **Shadow Strategy:** the Sheet shadow; it lies on the wall.
- **Border:** 1px `rule` at the edge; no inner outline.
- **Internal Padding:** 24px, 32px from 640px (48px for the large explanatory sheet).
- Numbered steps and level codes use display type in ultramarine. A pull quote opens with a drawn quotation mark in display type, in ultramarine, never a side stripe.

### Inputs / Fields
- **Style:** Paper, 1px Control Rule border, 2px corners, 8px by 12px, with a Cinzel label above in `ink-3`. Fields live on sheets, with one exception on the wall: the tip amount field in the piece record's action row, which appears only when asked for.
- **Focus:** border turns ultramarine with a 3px ultramarine ring at 15%. Caret and native controls (checkbox, select) take the accent.
- **Wall select:** the one control that sits on the wall (account picker in the rail): transparent, 1px Control Rule border that turns ink on hover, Spectral 0.85rem.

### Navigation
The rail: the wordmark "Manmade.works", with ".works" in ultramarine italic at 0.72em (it links to the landing, `/`), three Cinzel links (0.72rem, 0.2em) in `ink-2` that turn `ink` on hover, "The gallery" (`/gallery`), "Reader questions" (`/notes`) and "Studio", the account control, and the 1px rule line beneath. The footer is a rule, the examples notice and two text links.

### The Hung Work (signature)
A figure made of a frame plate, a dark sight edge, the picture, and a wall label 14px below. Four mouldings exist: gilt, patterned gilt, walnut-and-gilt, stone inlay. A work's moulding is derived from its identifier, so it keeps the same frame everywhere. Prints, and making-frames shown before a finished image exists, sit in a linen mat. When the artist keeps frames private the sight shows an italic line saying so.

### The Wall Label (signature)
A flat white card with a 1px rule border, centred under the work, 9 to 20rem wide and never wider than a small work. Order: title in capitals (linked), italic line (artist; or artist and date), level in ultramarine, one sentence from the evidence wording table, and an optional two-line italic quote from the artist. The wording is binding: a label states what the record shows and is never a verdict; it never calls a work or a person fake and never says "proven". Example works carry the title, artist and date, and the single word "Example"; they link to the museum and never show a level, price or collect control. A reader-question count, when present, is a small ruled capital link under the label.

### Sculpture (signature)
The work cut from its museum photograph on its own base, no frame, with a silhouette drop shadow and the same wall label. It joins the hang at medium size or larger.

### Lettering (signature)
Headline, a short paragraph and at most two buttons, set left-aligned in a column that hangs between frames. It is the only way text appears on the hang.

### The Paint Hero (signature)
The landing's first screen. A museum photograph of real paint, cropped close enough to read the strokes, fills the section edge to edge (`object-fit: cover`), under the Gallery White scrim. On the scrim: the Hero headline in ink with its one ultramarine italic word, one sentence in reading ink, a seal button into the gallery and a ghost button. At bottom right the whole painting hangs small in a photographed frame with a wall label whose ultramarine line reads "Example" and says which part is shown; frame and label are one link to the museum page. The photograph ships with a provenance record beside it (`public/salon/hero/`), as every raster does. The photograph itself is decoration (empty alt); the framed whole carries the description.

### The Room (signature)
One idea of the landing: a roman numeral in display type and Ultramarine, a headline-size title, and one or two paragraphs of wall text held to 60ch. A room may hang one framed work (a recorded piece when one exists, otherwise a labelled example) or one sheet beside or below the text. Rooms are numbered because they are walked in order; the numeral is a room number, not a category label.

### The Last Doorway (signature)
The end of the landing: a photographed frame plate used as a doorway casing, up to 1180px wide, with a few small framed examples seen through it against Paper Shade, a step deeper than the wall. The whole casing is one link into the gallery. An italic line under it names the works seen and says they are examples; a display line and a seal button repeat the way in.

### The Finding Aid (signature)
The showcase's controls: one white strip with a 1px rule border, lying on the wall above the grid. In order: search (wider than the rest), record, availability, artist, sort, a "Show examples" checkbox, then a ghost "Search" button and an ultramarine text link "Clear filters". Each control is a standard field with its Cinzel label above. Every change rewrites the address, so any view is a link, and the strip works as a plain form without scripting. The "Clear filters" slot is always reserved and only hidden when nothing is set, so the strip never shifts. From 1100px down it becomes two columns with search across the top; on phones the four selects sit two by two, and the checkbox and button share the last row.

### The Showcase Cell (signature)
A framed work in an equal cell with a printed label beneath. The label is the wall label's card (same white, rule border and shadow), up to 17rem wide: title in capitals (linked), italic artist line (linked to the artist), then one row with the level in ultramarine and, beside it in ink (Spectral 600, 0.82rem), the price or status: a price, "Reserved" with the price, "Collected" or "Not for sale". A recorded work adds its evidence sentence; a declared one does not repeat itself. Examples show title, artist and date and the single word "Example", link to The Met in a new tab, and never show a price or status. A work whose artist keeps the frames private shows the italic line saying so in a linen mat.

### The Object Record (signature)
The piece page. Left, the Hung Work at full size with its wall label; right, the record as wall text with no sheet, border or shadow. The record opens with the Piece title, a line "by artist · piece N" (1.125rem, reading ink, the artist linked), the Level sentence, a quiet ruled chip with the level code ("Level E0": Cinzel 0.7rem at 0.16em, 1px rule border) and, when the record states them, the reasons for that level in reading ink. There is no eyebrow above the title. Then the action row, the tabs and the open panel.

### The Action Row (signature)
One status line and one row of actions between two hairlines, always in the same place above the tabs because panels vary in length. The status line says who holds the piece and whether it is for sale. The row holds at most one seal button, "Collect · price", shown only when the piece is listed, and a ghost "Tip the artist". The ghost is replaced in place by the tip form: an amount field 6rem wide, the unit "USDC" printed beside it in reading ink, a near-black "Send N USDC" button that names the amount as typed, and a "Cancel" text link; one line of fine print says where the tip goes. Signed out, both buttons read "Sign in to collect · price" and "Sign in to tip the artist" and lead to sign-in. The holder sees a link to their files in place of the buttons; the artist sees no tip control. A sale reserved for someone else is said in Refusal Red text.

### Record Tabs (signature)
A WAI-ARIA tablist: The making, The record, Provenance, Questions (with its count when questions are shown), Rights. Labels are Cinzel capitals (0.74rem, 0.16em) in `ink-3`, 26px apart, on a hairline; hover turns a label ink; the open tab is Ultramarine with a 2px Ultramarine underline lying on the hairline. Arrow keys, Home and End move between tabs and only the open tab is in the tab order. Each tab but the first is a hash link (`#record`, `#provenance`, `#questions`, `#rights`), so a panel can be linked to. From 641px the row scrolls sideways if it must; on phones it wraps to two rows (4px by 20px gaps).

### The Making (signature)
The first panel. The artist's words, if any, as a pull quote; one sentence saying how many frames are public; then:
- **The making strip:** the public frames as a row of thumbnails, up to eight columns, 8px apart, each 4:3 on Paper Shade with a 1px rule outline (`ink-3` on hover). The picked one takes a 2px Ultramarine outline. A thumbnail is an index mark and the one place a picture is cropped; picking it hangs the whole frame on the wall, and picking it again returns the finished work.
- **The printed timeline:** a 1px `ink-3` hairline 22px tall with a 9px tick for each public frame and a rectangular marker: an ink bar on a 3px ring of wall colour with a 1px ink edge. While the finished work hangs the marker is hollow (wall colour inside the ink edge) and rests at the last frame. It is a native range input, so it keeps range semantics, keyboard steps and a spoken value ("Frame 5, date"). Shown only when there is more than one public frame.
- **Re-hanging:** the picked frame replaces the picture in the frame on the wall with the cross-fade; the wall label gains an Ultramarine line "Frame N · date", the linen mat is dropped, and an underlined Ultramarine Cinzel link "Back to the finished work" appears 14px under the label.
- **The phone making preview:** below 1100px the wall is far above the strip, so the picked frame is also shown full width under the timeline with a 1px rule outline. It is hidden from 1100px.
- A caption in quiet ink always says what is on the wall.

### Ledger Facts (signature)
The record's measured facts as a ruled ledger, not a grid of boxes. Each row sits between hairlines (14px above and below): a Cinzel label in an 11rem column, then the Fact figure, an inline bar when the fact is a share (3px high, ink on a track of `ink-3` at 22%), and a note in quiet ink (0.82rem) beneath. On phones the label stacks over the figure. A fact that is not a share has no bar.

### The Provenance Ledger (signature)
One dated list of everything that happened to the piece on-chain, oldest first. Each row sits between hairlines (11px above and below): the date in a 7.5rem column in quiet ink (0.82rem, tabular lining figures), then the event as a plain sentence. On phones the date stacks over the event. A line of quiet ink under the ledger says where it is read from.

### Folds
Detail most visitors skip (how to read the facts, on-chain details, the full public report) sits behind a fold: a summary in reading ink with a drawn chevron before it (a 6px corner of two 1.5px strokes, pointing right when closed and down when open, turning in 160ms). The chevron is drawn, never a glyph or an icon. Checkable values inside a fold are Data type under Cinzel labels.

### No Results (state)
When no work matches, a small centred sheet replaces the grid: a display line, one sentence, then a quiet chip for each active filter ("Clear record: Declared") that removes only that filter, and a ghost button that shows every work.

## Do's and Don'ts

### Do:
- **Do** put the art and the headlines on the wall and every fact, form and long text on a sheet. The piece page's object record is the one exception: its facts are wall text ruled by hairlines.
- **Do** keep the piece record's status line and action row in one fixed place above the tabs, and give every tab panel a hash link.
- **Do** keep the timeline a real range control with a spoken value, and say in words what is on the wall.
- **Do** use the one set of ink tokens (`ink`, `ink-2`, `ink-3`, `rule`) on wall and paper alike.
- **Do** frame every picture with one of the four photographed plates and its measured slices from `public/salon/frames/frames.json`; add a new moulding only as a new photographed plate with its provenance file. The landing hero is the single exception (The One Unframed Painting Rule).
- **Do** keep works close on the hang: gaps stay within 14 to 28px and sizes follow the rhythm. On the showcase keep cells equal and labels on one line per row.
- **Do** give every work a wall label and take the evidence sentence from the wording table unchanged.
- **Do** label every public-domain work "Example" and link it to its museum page.
- **Do** set display type at weight 600 inside sheets.
- **Do** give keyboard focus the same approach response as hover, and remove movement under reduced motion.
- **Do** keep product copy on creator and client screens free of "NFT", "mint", "gas" and "wallet".
- **Do** size a picture from its aspect ratio with `--h`, `--cap` and `--ar` (The Proportion Rule), and give every new layout its own `--h` and `--cap`.
- **Do** put filters and sorting on a white strip, never loose on the wall, and make every filtered view a link.
- **Do** keep a scrim between a photograph and any type set over it, in Gallery White, strong enough that ink lettering keeps its contrast.
- **Do** ship every new photograph with its provenance record beside it.
- **Do** keep errors and refusals red (`seal-2`); ultramarine is for decisions and emphasis.

### Don't:
- **Don't** draw a frame with CSS borders, gradients or bevels; frames are photographs.
- **Don't** hang a picture unframed or unlabelled. The wall is pale, so the photographed frame, the printed label and the hang are what make it a gallery and not a shop grid.
- **Don't** round anything beyond 2px, and don't use pills or circular controls.
- **Don't** add a second light: no side or bottom glows, no coloured shadows, no hard offset shadows, no gradient on the wall.
- **Don't** put a form field or a long paragraph directly on the wall; the wall select in the rail and the piece record's on-demand tip amount field are the only wall controls.
- **Don't** box the piece record: no sheet, border or shadow around the record column, its facts or its tabs, and no price-first card.
- **Don't** move the page, the frame or the label when a frame of the making is picked; only the picture changes.
- **Don't** use moss, amber or red to grade a work; a label's only colour is the ultramarine level line.
- **Don't** show a level, price, record or collect control on an example work.
- **Don't** use Cinzel for sentences or in lowercase, and don't use the mono face for anything but checkable values.
- **Don't** use a coloured side stripe for quotes or callouts.
- **Don't** introduce cool greys or pure black; every neutral is warm, and pure white is kept for paper (sheets, labels, fields) and the lettering on filled buttons.
- **Don't** crop, stretch or letterbox a picture to fit a cell; change `--h` or `--cap` instead.
- **Don't** add a second full-bleed or unframed painting; the landing hero is the only one.
- **Don't** use the Hero size anywhere but the landing headline.
- **Don't** let the finding aid change height or shift when a filter is set or cleared.
- **Don't** colour the wall or add any pattern beyond the tone-on-tone damask over plaster, and don't draw gilt: no gilt lines, plates, borders or lettering outside the photographed frames.
- **Don't** add a second accent, and don't spend ultramarine on decoration, borders of ordinary sheets or body text.
