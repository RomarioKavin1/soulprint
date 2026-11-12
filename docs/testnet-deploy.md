# Testnet deploy (Plan 1 Task 15)

`soulprint-deploy` (`contracts/deploy`) puts the system on testnet the way the sandbox harness
does locally, using the same code:

1. creates the keyed accounts (publisher, evidence sender, relayer, test USDC, optional demo accounts)
   as sub-accounts of your owner account;
2. publishes `piece.wasm` as a global contract by hash (S1);
3. deploys test USDC (6 decimals, open `faucet`, S5), unless `--usdc <token>` is given;
4. **genesis**: creates `soulprint-<version>.<owner>` in **one transaction** — create, transfer,
   deploy, `new` — with **no AddKey** (A5), funded with code storage + state + `--collection-free-near`
   (default 1 NEAR ≈ 14 creation costs, review I4);
5. verifies the collection has **zero access keys** and the code we built (sha256), then (with
   `--smoke`) has the demo artist create one standalone piece and checks it is live and keyless;
6. writes the `testnet` entry of `config/networks.json` (no secrets) and a services env file.

It is **resumable**: each step is recorded in `~/.soulprint/testnet/<collection>.state.json`
(mode 0600, holds the generated keys and the verifier seed). If a run stops, fix the cause and
run the same command again.

## What it costs

```
cd contracts && cargo run -q -p soulprint-deploy -- --owner <you>.testnet --plan
```

| | NEAR |
|---|---|
| publisher: global piece code, 10 × 393 143 bytes burnt + own code + 1 NEAR margin | 40.46 |
| collection: code + state + 1 NEAR free | 4.59 |
| evidence sender / relayer | 2 / 5 |
| test USDC | 2.10 |
| fee margin | 1 |
| **total** | **≈ 55.1** |
| `--demo-accounts` (artist 2, client 3, buyer 3, arbitrators 1 + 1) | + 10 |

The global-code burn (about 39.3 NEAR) is most of it and is not refundable. The publisher call uses
300 Tgas on purpose: near-workspaces' `max_gas()` is 1 PGas, which is prepaid at the pessimistic gas
price and locks about 0.6 NEAR (found in the dry run: `LackBalanceForState` with 0.64 NEAR margin).

## Run it

1. Fund an owner account with ≈ 56 NEAR (≈ 66 with demo accounts).
2. Give the tool its key, using one of:
   - `export OWNER_SECRET_KEY=ed25519:…` — near-cli-rs keeps keys in the macOS keychain by default;
     print it with `near account export-account <you>.testnet using-private-key network-config testnet`;
   - a legacy credentials file `~/.near-credentials/testnet/<you>.testnet.json` (or `--key-file`).
3. Rehearse locally (same code path on a throwaway sandbox, nothing written to `config/`):
   `cargo run -q -p soulprint-deploy -- --dry-run-sandbox`
4. Deploy:
   ```
   cd contracts
   cargo run -q -p soulprint-deploy -- --owner <you>.testnet --demo-accounts --smoke
   ```
   Options: `--version v2` (new collection name), `--time fast|production` (default `fast`, see
   below), `--governance <id>` (default the owner), `--usdc <token>`, `--collection-free-near N`,
   `--skip-publish` (piece code already published under this hash), `--rpc <url>`, `--state <path>`.
5. Fill the README "Deployed code hashes" row from the printed entry (collection, `piece_code_hash`,
   `genesis_tx`).
6. Run the services and web against it:
   ```
   scripts/testnet-stack.sh            # sources ~/.soulprint/testnet/<collection>.services.env
   ```
   The indexer reads blocks from neardata (`NEARDATA_URL`, default `https://testnet.neardata.xyz`)
   from the genesis block. Ports: `EVIDENCE_PORT`, `INDEXER_PORT`, `RELAYER_PORT`, `WEB_PORT`.

Testnet sign-in uses real wallets (NEAR Connect); demo-account keys are in the state file for
scripted rehearsals, never in `config/networks.json` or the browser.

## Decisions

- **Time preset `fast` on testnet** (seconds-scale review/dispute windows, `common::TimeConfig::fast`)
  so judges and the demo video can walk a whole commission, dispute and timeout in minutes. It is
  fixed at genesis; a production-timed collection is a second deploy:
  `--version v2 --time production --skip-publish` (≈ 15 NEAR: the piece code is already published
  under the same hash, and `--smoke` proves it). Cost if wrong: testnet windows too short for a
  real commission — acceptable on a demo network.
- **Governance = owner** by default. The owner account keeps its keys (it is not the collection);
  governance can only manage verifier keys (T12).

## Verified

- `cargo test -p soulprint-deploy`: `testnet_genesis_dry_run_is_keyless_resumable_and_writes_config`
  (full path on a sandbox, a second run changes nothing, no secret in `networks.json`, state file
  0600) and `budget_covers_the_global_burn_and_collection_free_balance`.
- Testnet-mode services against a held dry run (`--dry-run-sandbox --hold --config <tmp>` +
  `BLOCK_SOURCE=rpc scripts/testnet-stack.sh`): evidence, indexer and relayer start from the env
  file; the indexer finds the smoke piece from the genesis block.
- Not verified until it runs on testnet: neardata as the indexer source, wallet sign-in (Spike S2).
