---
name: Soulprint Salon
description: A salon hang of real art on a lit claret wall; every work in a photographed period frame with a printed label that says exactly what its record shows.
colors:
  wall: "#4f161b"
  wall-deep: "#2b0a0d"
  gilt: "#c9a24a"
  gilt-light: "#ecd18a"
  gilt-dark: "#6e4f17"
  gilt-plate: "#d9b866"
  seal: "#7a1e26"
  seal-plate: "#8a222b"
  seal-plate-ink: "#f8e9d0"
  wall-ink: "#f4e6c6"
  wall-ink-2: "#dcc49b"
  wall-ink-3: "#bd9e75"
  wall-rule: "rgba(233, 201, 122, 0.28)"
  wall-recess: "rgba(0, 0, 0, 0.22)"
  wall-seal-2: "#f1a08e"
  wall-moss: "#a9d29d"
  wall-amber: "#f0c56a"
  paper: "#f3ead6"
  paper-2: "#e8dbbd"
  sheet-ink: "#2a1f17"
  sheet-ink-2: "#5a4636"
  sheet-ink-3: "#7d6650"
  sheet-rule: "#cdb98f"
  sheet-seal-2: "#5b141b"
  sheet-moss: "#355a35"
  sheet-amber: "#8c5e0f"
  plaque: "#efe6d2"
  plaque-ink: "#2a1a05"
  plaque-ink-2: "#4a3a26"
  chip-gilt: "#e3c77e"
  field: "#fffaf0"
  sight: "#1a1210"
  mat-linen: "#ece3cd"
typography:
  display:
    fontFamily: "Bodoni Moda, 'Bodoni 72', Didot, serif"
    fontSize: "clamp(2.4rem, 3.4vw, 3.6rem)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Bodoni Moda, 'Bodoni 72', Didot, serif"
    fontSize: "clamp(2.2rem, 4vw, 3.4rem)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Bodoni Moda, 'Bodoni 72', Didot, serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
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
components:
  button-seal:
    backgroundColor: "{colors.seal-plate}"
    textColor: "{colors.seal-plate-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.plate}"
    padding: "10px 16px"
  button-primary:
    backgroundColor: "{colors.gilt-plate}"
    textColor: "{colors.plaque-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.plate}"
    padding: "10px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.wall-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.plate}"
    padding: "10px 16px"
  sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.sheet-ink}"
    rounded: "{rounded.none}"
    padding: "{spacing.sheet-wide}"
  field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.sheet-ink}"
    rounded: "{rounded.plate}"
    padding: "8px 12px"
  plaque:
    backgroundColor: "{colors.plaque}"
    textColor: "{colors.plaque-ink}"
    typography: "{typography.plaque-title}"
    rounded: "{rounded.none}"
    padding: "8px 14px 9px"
  chip:
    backgroundColor: "{colors.chip-gilt}"
    textColor: "{colors.plaque-ink}"
    rounded: "{rounded.none}"
    padding: "4px 12px"
  chip-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.wall-ink-2}"
    rounded: "{rounded.none}"
    padding: "4px 12px"
  wall-select:
    backgroundColor: "transparent"
    textColor: "{colors.wall-ink}"
    rounded: "{rounded.plate}"
    padding: "4px 26px 4px 10px"
---

# Design System: Soulprint Salon

## Overview

**Creative North Star: "The Salon Hang"**

Soulprint is one room: a claret wall, lit once from the cornice, hung close with works in real period frames. Every work carries a flat printed label that states what its record shows and nothing more. The reference is a Paris Salon wall of the 1880s, where pictures touch shoulders and sizes vary, and it replaces the online-shop pattern of unframed images in a white grid.

There are two materials and they never blur. **The wall** (claret, damask, gilt, light lettering) carries the art, the headlines and navigation. **The sheet** (ivory catalogue paper with dark print) carries facts, forms and reading. The same token names (`ink`, `ink-2`, `ink-3`, `rule`, `paper-2`, `seal-2`, `moss`, `amber`) resolve to light values on the wall and dark values inside a sheet, so a component reads correctly in either place without a variant.

The physical parts are photographs, not drawings. The frames are four empty cassetta frames from The Metropolitan Museum of Art (Open Access, CC0) cut into nine-slice plates with measured slices; sculpture is cut from its museum photograph and stands on its own base. Each raster ships with a provenance record next to it. Operate screens (studio, rooms, vault, pay) live in the same room and simply use more sheet and less wall.

**Key Characteristics:**
- One claret wall, one light from the top, an authored tone-on-tone damask.
- Photographed period frames as nine-slice border plates; four mouldings, one per work for life.
- Flat ivory wall labels: Cinzel title, italic Spectral line, claret level.
- Ivory catalogue sheets with an inset hairline for every fact and form.
- Square forms; the only radius is 2px on controls.
- One authored interaction: a work steps forward and the wall behind it warms.

## Colors

A warm, narrow palette: claret, gilt and ivory, with dark brown print. Nothing cool, nothing neutral grey.

### Primary
- **Salon Claret** (`wall`): the wall itself, the body background of every route.
- **Claret Shadow** (`wall-deep`): the root behind the wall (overscroll and the foot of the room).
- **Wax Seal** (`seal`, painted as `seal-plate` on buttons with `seal-plate-ink` lettering): the decisive action, the level line on a label, numerals and the drawn quotation mark on sheets, input focus and caret, the timeline scrubber.

### Secondary
- **Leaf Gilt** (`gilt`): the 2px picture rail, ghost-button and wall-control borders, text selection.
- **Gilt Highlight** (`gilt-light`): the emphasised word in wall lettering, the evidence sentence on a piece page, the focus ring on the wall.
- **Gilt Shade** (`gilt-dark`): scrollbar thumb and the sheet's inset hairline (at 35% alpha).
- **Gilt Plate** (`gilt-plate`) and **Label Gilt** (`chip-gilt`): the painted plate of the ordinary primary button and of state chips.

### Tertiary
- **Moss** (`wall-moss` / `sheet-moss`) and **Amber** (`wall-amber` / `sheet-amber`): confirmation and caution text or thin borders, small and rare. **Seal Tint** (`wall-seal-2` / `sheet-seal-2`) is error and warning text.

### Neutral
- **Wall Lettering** (`wall-ink`, `wall-ink-2`, `wall-ink-3`): headline, reading and quiet text on claret. **Wall Rule** (`wall-rule`) is a translucent gilt hairline; **Wall Recess** (`wall-recess`) is a darkened well.
- **Catalogue Ivory** (`paper`, `paper-2`): the sheet and its recessed wells (code blocks, bar tracks).
- **Print Brown** (`sheet-ink`, `sheet-ink-2`, `sheet-ink-3`) and **Sheet Rule** (`sheet-rule`): text and dividers on ivory.
- **Label Card** (`plaque`, `plaque-ink`, `plaque-ink-2`): the wall label and its print.
- **Field White** (`field`): input background, always on a sheet.
- **Sight** (`sight`) and **Linen Mat** (`mat-linen`): the dark sight edge inside a frame, and the mat used for prints and for making-frames shown in place of a finished image.

### Named Rules
**The Two Inks Rule.** Never hard-code a text colour for wall or sheet. Use `ink`, `ink-2`, `ink-3`, `rule`; the scope (`:root`/`.on-wall` versus `.card`/`.sheet`/`.on-paper`) picks the value.

**The Seal Is One Decision Rule.** The claret seal button marks the one decisive action in a view (walk the hang, start a piece, the committing step of a flow). Ordinary actions are gilt plates or ghosts.

**The Claret Level Rule.** On a label, the only coloured line is the level or the word "Example", in seal claret. Colour never grades a work; green, amber and red are for system state only.

## Typography

**Display Font:** Bodoni Moda, optical-size axis on (fallback Bodoni 72, Didot, serif)
**Body Font:** Spectral, 300 to 600 with italics (fallback Georgia, serif)
**Label Font:** Cinzel, 400/600/700 (fallback Trajan Pro, serif)
**Data Font:** JetBrains Mono 400 (fallback ui-monospace, Menlo)

**Character:** High-contrast Didone for what is said aloud on the wall, inscriptional capitals for what is printed on plates and labels, and a quiet book serif with old-style figures for reading. Mono appears only for values a reader could check on-chain.

### Hierarchy
- **Display** (400, clamp(2.4rem, 3.4vw, 3.6rem), line-height 1, -0.02em): lettering painted on the wall. One word may be italic in Gilt Highlight. The header wordmark is the same face at 2rem to 2.4rem.
- **Headline** (400, clamp(2.2rem, 4vw, 3.4rem), line-height 1, -0.015em): page titles on the wall; the piece title runs up to 4.4rem.
- **Title** (600 on sheets, 1.875rem): section headings inside sheets; large figures in fact grids use the same style.
- **Body** (400, 17px, line-height 1.55): reading text; wall paragraphs are held to 32 to 36ch, sheet text to about 62ch. Secondary text is 0.875rem, fine print 0.75rem.
- **Label** (Cinzel 600, 0.72rem, 0.2em, uppercase): field labels, definition terms, navigation. Buttons are 0.76rem at 0.13em; chips 0.7rem at 0.14em.
- **Wall label** (Cinzel 700, 0.72rem, 0.1em uppercase title, two lines at most; Spectral italic 0.82rem line; Cinzel 600 0.7rem claret level; Spectral 0.78rem note).
- **Data** (JetBrains Mono 400, 0.75rem, tabular figures): account names, fingerprints, hashes, codes.

### Named Rules
**The Heavier-On-Paper Rule.** Bodoni's hairlines break at small sizes on ivory. Any display type inside a sheet is weight 600; weight 400 is for large lettering on the wall.

**The Capitals Are Printed Rule.** Cinzel is always uppercase, tracked 0.1em to 0.3em, and at or below 0.8rem. It is never used for sentences.

## Layout

The page column is 1400px wide with a 16px gutter (32px from 640px) and 112px of wall left under the content. The header is the picture rail: wordmark lower-left, navigation lower-right, and a flat 2px gilt line running the full width beneath them.

**The hang** is the main layout. It is a wrapping, centred flex row with one centre line, tight gaps (14 to 26px across, 18 to 28px down), and four sizes set by height: small clamp(110px, 10.5vw, 160px), medium clamp(190px, 18vw, 290px), large clamp(230px, 23vw, 360px), extra clamp(260px, 30vw, 460px). Sizes follow a fixed rhythm (large, two small, medium, two small, large, medium ...), and two consecutive small works stack in one column. Sculpture and works taller than 1.45:1 never hang small. Lettering blocks (18 to 24rem wide, left-aligned) hang in line with the frames as if painted on the wall. On the home page the hang bleeds wall to wall, past the page column, with clamp(16px, 3vw, 48px) of side padding.

Below the hang, sheets sit in a centred reading column (max-w-5xl, narrower for forms) with 48px between sheets and 96 to 128px of wall above the first. The piece page is a 12-column grid from 1024px: the framed work in 7 columns at clamp(320px, 54vh, 640px) tall, title, evidence sentence and facts sheet in 5.

**Phones (to 640px):** works are sized by width, not height (large 76vw, medium 66vw, small 38vw side by side as a pair; a lone small work hangs centred at 66vw), frame mouldings thin to 6% of the width, and the piece image is 84vw. Below 1024px the welcome lettering moves ahead of the first work.

## Elevation & Depth

Depth is physical and has one source: the light at the cornice. The wall is lit by a single warm radial gradient at the top over the damask; objects cast soft shadows straight down. There are no hard offset shadows and no glows except the wall warming behind an approached work.

### Shadow Vocabulary
- **Hung frame** (`0 26px 36px -18px rgba(8,0,0,0.85), 0 6px 10px -2px rgba(8,0,0,0.5)`): every framed work at rest.
- **Approached frame** (`0 34px 44px -18px rgba(8,0,0,0.9), 0 8px 14px -2px rgba(8,0,0,0.55)` with a 4px lift): hover or focus within.
- **Moulding depth** (`inset 0 6px 9px -4px rgba(0,0,0,0.5), inset 5px 0 8px -5px rgba(0,0,0,0.35)`): the frame shading the picture's top and left edges.
- **Sheet** (`0 1px 0 rgba(255,255,255,0.6) inset, 0 18px 40px -18px rgba(0,0,0,0.75), 0 2px 6px rgba(0,0,0,0.35)`): catalogue sheets.
- **Label and plate** (`0 2px 4px rgba(0,0,0,0.35)` for labels; `0 2px 6px rgba(0,0,0,0.3)` for gilt buttons; the seal button adds `inset 0 0 0 1px rgba(233,201,122,0.55)`).
- **Sculpture** (`drop-shadow(0 3px 2px rgba(0,0,0,0.55)) drop-shadow(0 12px 10px rgba(0,0,0,0.3))`): follows the cut-out's silhouette.

### Motion
- **Approach:** frame lifts 4px and a radial warm patch fades in behind it, 500ms, `cubic-bezier(0.16, 1, 0.3, 1)`. Triggered by hover and by keyboard focus within.
- **Arrival:** each work comes up from 35% brightness once, 1100ms, staggered 60ms per work after 120ms.
- **Controls:** 200ms colour, shadow and brightness changes only.
- **Reduced motion:** no lift, no arrival, no smooth scroll.

### Named Rules
**The One Light Rule.** Light comes from the top of the room. Shadows fall down, inner shading sits on the top and left of a picture, and nothing is lit from below or from the side.

## Shapes

Everything is square. Sheets, labels, chips, frames and pictures have no radius; controls (buttons, fields, the wall select, the focus ring) take 2px, the softness of a cut plate. There are no pills and no circles.

Borders are either real or printed. A frame is a photographed moulding drawn as a border image whose width is 8.5% of the work's height (minimum 12px; 6% of width on phones) with true corners and stretched sides; the stone-inlaid frame repeats its sides instead of stretching. A sheet has a 1px gilt-shade hairline inset 8px from its edge, like a printed border on a catalogue page. Other lines are 1px rules in the scoped `rule` colour.

## Components

### Buttons
Small engraved plates: Cinzel capitals, 2px corners, 10px by 16px.
- **Seal:** claret plate, cream lettering, thin gilt inner line. The decisive action.
- **Primary:** gilt-painted plate with dark lettering. Ordinary committing actions inside sheets.
- **Ghost:** transparent with a 1px gilt border at 70%; fills with gilt at 16% on hover. Works on wall and sheet through the scoped ink.
- **Hover / Focus / Disabled:** hover brightens the plate (1.08 gilt, 1.12 seal); focus is a 2px outline offset 3px, Gilt Highlight on the wall and Wax Seal on a sheet; disabled is 45% opacity.

### Chips
- **Style:** a small printed state label, square, Label Gilt with dark capitals.
- **Quiet:** transparent with an inset 1px rule, for secondary states.

### Cards / Containers (the catalogue sheet)
- **Corner Style:** square.
- **Background:** Catalogue Ivory with a faint lighter wash over the top 40%.
- **Shadow Strategy:** the Sheet shadow; it hangs on the wall.
- **Border:** 1px gilt-shade hairline inset 8px.
- **Internal Padding:** 24px, 32px from 640px (48px for the large explanatory sheet).
- Inside a sheet all ink tokens turn dark. Numbered steps use roman numerals in display type, in seal claret. A pull quote opens with a drawn quotation mark in display type, never a side stripe.

### Inputs / Fields
- **Style:** Field White, 1px Sheet Rule border, 2px corners, 8px by 12px, with a Cinzel label above. Fields live on sheets only.
- **Focus:** border turns Wax Seal with a 3px seal ring at 15%.
- **Wall select:** the one control that sits on the wall (account picker in the rail): transparent, 1px gilt border at 55%, Spectral 0.85rem.

### Navigation
The picture rail: wordmark with the word "Salon" in small capitals beside it, three Cinzel links (0.72rem, 0.2em) in secondary wall ink that brighten on hover, the account control, and the 2px gilt line. The footer is a rule, the examples notice and two text links.

### The Hung Work (signature)
A figure made of a frame plate, a dark sight edge, the picture, and a wall label 14px below. Four mouldings exist: gilt, patterned gilt, walnut-and-gilt, stone inlay. A work's moulding is derived from its identifier, so it keeps the same frame everywhere. Prints, and making-frames shown before a finished image exists, sit in a linen mat. When the artist keeps frames private the sight shows an italic line saying so.

### The Wall Label (signature)
A flat ivory card, centred under the work, 9 to 20rem wide and never wider than a small work. Order: title in capitals (linked), italic line (artist; or artist and date), level in claret, one sentence from the evidence wording table, and an optional two-line italic quote from the artist. The wording is binding: a label states what the record shows and is never a verdict; it never calls a work or a person fake and never says "proven". Example works carry the title, artist and date, and the single word "Example"; they link to the museum and never show a level, price or collect control. A reader-question count, when present, is a small ruled capital link under the label.

### Sculpture (signature)
The work cut from its museum photograph on its own base, no frame, with a silhouette drop shadow and the same wall label. It joins the hang at medium size or larger.

### Lettering (signature)
Headline, a short paragraph and at most two buttons, set left-aligned in a column that hangs between frames. It is the only way text appears on the hang.

## Do's and Don'ts

### Do:
- **Do** put the art and the headlines on the wall and every fact, form and long text on a sheet.
- **Do** use the scoped ink tokens so the same component reads on wall and sheet.
- **Do** frame every picture with one of the four photographed plates and its measured slices from `public/salon/frames/frames.json`; add a new moulding only as a new photographed plate with its provenance file.
- **Do** keep works close: hang gaps stay within 14 to 28px and sizes follow the rhythm.
- **Do** give every work a wall label and take the evidence sentence from the wording table unchanged.
- **Do** label every public-domain work "Example" and link it to its museum page.
- **Do** set display type at weight 600 inside sheets.
- **Do** give keyboard focus the same approach response as hover, and remove movement under reduced motion.
- **Do** keep product copy on creator and client screens free of "NFT", "mint", "gas" and "wallet".

### Don't:
- **Don't** draw a frame with CSS borders, gradients or bevels; frames are photographs.
- **Don't** hang unframed images in an evenly spaced grid on a pale ground.
- **Don't** round anything beyond 2px, and don't use pills or circular controls.
- **Don't** add a second light: no side or bottom glows, no coloured shadows, no hard offset shadows.
- **Don't** put a form field or a long paragraph directly on the wall; the wall select in the rail is the only wall control.
- **Don't** use moss, amber or red to grade a work; a label's only colour is the claret level line.
- **Don't** show a level, price, record or collect control on an example work.
- **Don't** use Cinzel for sentences or in lowercase, and don't use the mono face for anything but checkable values.
- **Don't** use a coloured side stripe for quotes or callouts.
- **Don't** introduce cool greys, pure white or pure black; every neutral is warm.
