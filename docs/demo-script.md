# Demo script (3 minutes)

Two places, both ready:
- **Live (testnet):** https://manmade-seven.vercel.app — real pieces on NEAR testnet, links out to NearBlocks. Signing in needs a NEAR testnet wallet, so show the live site as a **visitor** (no signing).
- **Local (sandbox):** `make demo`, then http://127.0.0.1:3000 — switch people with the **Signed in as** menu (artist, client, buyer, shop…). Every account starts with 1000 test USDC. Use it for the **making and selling** part.

Prepare: run `make demo` (a fresh local chain) right before recording. Two windows side by side: left **Artist** (open http://127.0.0.1:3000/studio?as=artist.test.near), right **Visitor** (http://127.0.0.1:3000/gallery?as=shop.test.near). Each window keeps its own person. A sheet of paper and a pencil in front of the webcam (or a drawing app with **Record my screen**). Have the live site open in a third tab, on a piece with public frames.

## 1. The idea, live on testnet (~50 s)

| # | Do | Say |
|---|---|---|
| 1 | Live site, landing: let the Van Gogh brushwork sit for a beat, scroll once. | "AI is useful, but the soul of real art should be protected. Manmade hangs every work with the record of how it was made." |
| 2 | **Enter the gallery**. **Sort** → *Title, A–Z*; toggle **Show examples**; untick **Hide test pieces** to show the pieces made while building, then tick it again. Your own published pieces always show. | "Each label says only what the record shows: declared, recorded while made, or with live checks passed. Never 'proven not AI'." |
| 3 | Open a piece: your own if you published one on testnet, otherwise the test piece by direct link https://manmade-seven.vercel.app/p/p159.soulprint-v1.soulprint-owner-12f173.testnet (hidden from the walls, still on-chain, listed at 5 USDC). In **The making**, click a frame: it hangs on the wall. **Back to the finished work**. | "Every piece carries its own making." |
| 4 | Point at **Token #N of the Manmade collection, on NEAR's NEP-171 token standard** → **See it on NearBlocks** (NearBlocks names the contract by its code name, "Soulprint"). | "Every artwork is its own NEAR account and a token in the collection — an NFT that carries its making, rights and income." |
| 5 | Back: **The record** tab → the ✓ **Recomputed in your browser** line → open **On-chain details** (accounts and token link out). **Provenance** tab. | "Anyone can recompute the report's fingerprint here and check it on-chain." |

## 2. Make, record, sell — local (~100 s)

| # | Who | Do | Expect |
|---|---|---|---|
| 1 | Artist | Studio → **New piece** (on the landing it is **Start a piece**) → working title → **Create the piece**. | Studio, status *Being made*. |
| 2 | Artist | **Record with camera** (or **Record my screen**). Draw. **Take a frame now** 3–4 times. **Stop**. | *N of N frames saved to the record*. Say: "Each frame is signed on my device, chained, and anchored on the piece." |
| 3 | Artist | **Select all on this page** → **Show on the public page**. **Final file**: choose the image → **Check the record** → **Finish and seal the record** (keep the tab open until it says *Finished*). | Status *Finished*. A 2-minute demo reads *Declared by the artist*; the public page says why — say so: "a real 30-minute session reads *Recorded while made*." |
| 4 | Artist | **The piece's page**: title is prefilled, add a story → **Publish the page**. Then **Offer it to collectors (optional)** → price **3** → **List for sale**. | *Published.* / *Listed at 3 USDC*. |
| 5 | Visitor (shop) | Gallery → the new piece → **Tip the artist** → type 1.5 → **Send 1.5 USDC**. | *Sent 1.5 USDC to artist.test.near. Thank you.* "A tip goes straight to the artist." |
| 6 | Visitor (buyer: **Signed in as** → Buyer) | **Collect · 3 USDC**. | *This piece is yours.* "Files and rights go to the collector; every resale pays the artist 5%." |
| 7 | Visitor (buyer) | **Questions** tab → **Ask about this record** (optional, 10 s). | "Readers ask questions instead of calling art fake; only questions most raters find useful are shown." |

Close (10 s): "Manmade — real art, hung with its making. manmade dot works."

## If time allows: commissions (local)
Studio → **Take a commission** (client `client.test.near`, price 150 USDC) → the client pays into the piece → the artist records and delivers → the client accepts → payment released. The same piece account is the escrow.

Backup if the camera is unavailable: **Record my screen**. If the live site's gallery says it could not load the artists' work, the tunnel URL changed — see docs/deploy.md.
