# Demo script (3 minutes) — DESIGN §10

Local run: `make demo`, open http://127.0.0.1:3000. Switch people with **Signed in as**.
Sandbox accounts: `artist.test.near`, `client.test.near`, `buyer.test.near`, `shop.test.near`,
`arb.test.near`, `fallback.test.near`. Everyone starts with 1000 test USDC. Timings are
seconds-scale (review 20 s minimum, each dispute stage 20 s).

Prepare: two browser windows side by side — left **Artist**, right **Client** (the right one
later becomes **Shop** and **Buyer**). Have a drawing app or a sheet of paper in front of the
webcam.

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
| 6 | — | History view (Plan 3 Task 6, not built yet) — instead open the proof page's **Verify on-chain**. | | Accounts, code hash, anchors, attesting key. |

Timings: record once end-to-end on testnet before submission and note them here.

Backup if the camera is unavailable: use **Record my screen**.
