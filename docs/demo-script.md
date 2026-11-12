# Demo script (3 minutes)

Local run: `make demo`, open http://127.0.0.1:3000. Switch people with **Signed in as**.
Sandbox accounts: `artist.test.near`, `client.test.near`, `buyer.test.near`, `shop.test.near`,
`arb.test.near`, `fallback.test.near`. Everyone starts with 1000 test USDC.

Prepare: two browser windows side by side — left **Artist**, right **Visitor** (signed in as
`shop`, later **Buyer**). Have a drawing app or a sheet of paper in front of the webcam.

## Main demo: the making, shown (showcase)

| # | Who | Do | Say | Expect |
|---|---|---|---|---|
| 1 | Artist | Home → **Start a piece**. Rights **Commercial, non-exclusive**, royalty 5% → **Create the piece**. | "Every artwork is its own account on NEAR. It carries its own making." | Studio: status *Being made*. |
| 2 | Artist | **Record with camera** (or screen). Draw. **Take a frame now** a few times. | "Every frame is signed on my device and chained; heads are anchored on the piece." | *N of N frames saved to the record*. |
| 3 | Artist | **Select all** → **Show on proof page**. Final image → **Check the record** → **Finish and seal the record**. | "The evidence service computes facts and signs them onto the piece." | Status *Finished*. |
| 4 | Artist | **Publish the proof page**, add a story → **Save story**. | | *Published.* |
| 5 | Visitor | Open **Gallery**. Click the card, then the artist's name. | "The gallery says only what each record shows. A 2-minute demo is *Declared by the artist*; a real session of 30+ minutes reads *Recorded while made: …*" | Card with the last public frame, level, story; artist page lists their work. |
| 6 | Artist | Studio → **Offer it to collectors** → price **3** → **List for sale**. | "Selling is optional." | *Listed at 3 USDC*. |
| 7 | Visitor | Piece page → **Support the artist**: 1.5 → **Send a tip**. | "A tip goes straight to the artist, whether or not the piece is for sale." | *Sent 1.5 USDC to artist.test.near*. |
| 8 | Buyer | Piece page → **Collect for 3 USDC**. | "The buy is pinned to this listing. Files and rights go to the collector; every resale pays the artist." | *Collected by buyer.test.near*; *This piece is yours.* |
| 9 | Anyone | Piece page → **Verify on-chain**. | "Anyone can recompute the report's fingerprint and compare it with the piece." | ✓ recomputed fingerprint, accounts, code hash, anchors. |

## Commissions (if time allows)

Seconds-scale timings (review 20 s minimum, each dispute stage 20 s). Right window: **Client**,
later **Shop** and **Buyer**.

| # | Who | Do | Say | Expect |
|---|---|---|---|---|
| 1 | Artist | Studio → **New commission**. Client `client.test.near`, price **150 USDC**, rights **Commercial, non-exclusive** (a mascot). **Create the commission**. Copy the client link. | "Each commission is its own account on NEAR." | Piece page: *Waiting for the client's payment*, fingerprint shown. |
| 1 | Client | Open the link → **Pay 150 USDC into the piece** (use **Get test USDC** first on a fresh account). | "The payment sits inside the piece, bound to the terms I was shown." | Status *In progress*; *Held in the piece 150 USDC*. |
| 2 | Artist | **Record with camera** (or screen). Draw. **Take a frame now** a few times. | "Every frame is signed on my device and chained; heads are anchored on the piece." | *N of N frames saved to the record*. |
| 2 | Client | **Ask for a live code**. | "I can ask for proof that this is happening now." | Artist sees a big code (e.g. `K7Q2MX`); writes it on the drawing; **It's in the work**. |
| 2 | Artist | Review frames → **Select all** → **Show to client**. | | Client's room shows *Work in progress* frames. |
| 3 | Artist | Deliver: choose the final image, **Check the record** → **Deliver to the client**. | "The evidence service computes facts and signs them onto the piece." | *Delivered — client reviewing*. |
| 3 | Client | **Accept** → **Accept the piece**. | | *Complete*. Payment released to the artist (*Money for you* → **Collect**). |
| 3 | Artist | **Publish the proof page**; add a story. Open it. | "The proof page says exactly what the record shows — and never the price." | Sentence like *Recorded while made: …* (E2/E3 needs a real session ≥ 30 min; a 2-minute demo shows *Declared by the artist* — say so), badge *Commissioned and accepted*, ✓ recomputed fingerprint. |
| 4 | Shop | `/pay/<piece>` → **2 USDC** → **Pay into the piece**. | "A merch shop pays a licence fee into the piece itself." | Client's vault: *Income held for the holder 2 USDC*. |
| 5 | Client | Vault → price **200** → **List for sale**. | | *Listed at 200 USDC*. |
| 5 | Buyer | `/buy/<piece>` → **Buy for 200 USDC**. (Optionally Shop pays again at the same moment.) | "The buy is pinned to this listing, price and income pool; a payment racing the sale goes to the buyer." | *It's yours*; buyer's vault shows the files and the pool; artist credit gains the 5% royalty. |
| 5 | Client | Reload the vault. | "The seller's access ended with the sale." | *Only the current owner of this piece can open its files.* |
| 6 | Anyone | Open the room or vault: **History**. Then the proof page's **Verify on-chain**. | "Every step is on the piece; the history is rebuilt from its events." | Payment, delivery, sale with royalty, income — in order; accounts, code hash, anchors, attesting key. |

Timings: record once end-to-end on testnet before submission and note them here.

Backup if the camera is unavailable: use **Record my screen**.
