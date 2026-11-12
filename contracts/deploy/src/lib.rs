//! Plan 1 Task 15: testnet genesis (A5, review I4).
//!
//! Stands up the system on a public network the way `tests::World` does on the sandbox:
//! publish the piece code globally by hash, deploy test USDC (S5), create the service accounts,
//! then create the collection keylessly in ONE transaction (create + transfer + deploy + init, no
//! AddKey), and verify the collection has zero access keys and the expected code.
//!
//! Resumable: every step is recorded in a state file (which also holds the generated keys), so
//! a run that stops half way (RPC error, balance ran out) continues where it stopped.

use anyhow::{anyhow, bail, Context, Result};
use near_workspaces::types::{Gas, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountId, Network, Worker};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;

pub const NEAR: u128 = 10u128.pow(24);
/// Storage price: 10^19 yocto per byte (protocol constant since genesis).
pub const BYTE: u128 = 10u128.pow(19);
/// A global contract burns 10× the storage of its code (NEP-591).
pub const GLOBAL_FACTOR: u128 = 10;

#[derive(Clone, Debug)]
pub struct Options {
    /// `v1` → collection `soulprint-v1.<owner>`.
    pub version: String,
    /// Defaults to the owner.
    pub governance: Option<AccountId>,
    pub time_name: String,
    /// Free balance the collection keeps beyond its code + state (review I4: several creation costs).
    pub collection_free: u128,
    /// Reuse an existing NEP-141 instead of deploying test USDC.
    pub usdc: Option<AccountId>,
    pub demo_accounts: bool,
    /// The piece code is already published globally (same hash, e.g. by an earlier version's
    /// deploy): skip the publisher account and its ≈ 40 NEAR burn. `--smoke` proves it exists.
    pub skip_publish: bool,
    /// After genesis, the demo artist creates one standalone piece: proves the global code is
    /// distributed and the piece account is keyless. Needs `demo_accounts`.
    pub smoke: bool,
    /// Value written into the collection (`network` field; signed messages must match it).
    pub network_id: String,
    pub rpc_url: String,
}

impl Options {
    pub fn time(&self) -> Result<common::TimeConfig> {
        match self.time_name.as_str() {
            "fast" => Ok(common::TimeConfig::fast()),
            "production" => Ok(common::TimeConfig::production()),
            t => bail!("unknown time preset {t} (fast | production)"),
        }
    }
}

/// Persisted between runs. Holds secret keys: written 0600, never committed.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct State {
    pub collection: String,
    /// role → account id
    pub accounts: BTreeMap<String, String>,
    /// role → secret key (ed25519:…)
    pub keys: BTreeMap<String, String>,
    /// Completed step names.
    pub done: Vec<String>,
    pub verifier_seed_hex: String,
    pub evidence_master_key_hex: String,
    pub piece_code_hash_hex: String,
    pub collection_code_hash_hex: String,
    pub genesis_tx: String,
    pub start_block: u64,
    pub usdc: String,
    pub smoke_piece: String,
}

impl State {
    fn is_done(&self, step: &str) -> bool {
        self.done.iter().any(|s| s == step)
    }
    pub fn is_done_all(&self, steps: &[&str]) -> bool {
        steps.iter().all(|s| self.is_done(s))
    }
    fn mark(&mut self, step: &str) {
        if !self.is_done(step) {
            self.done.push(step.to_string());
        }
    }
    pub fn load(path: &Path) -> Result<Option<State>> {
        match std::fs::read_to_string(path) {
            Ok(s) => Ok(Some(serde_json::from_str(&s).with_context(|| format!("{} is not a deploy state", path.display()))?)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(self)? + "\n")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
        }
        std::fs::rename(&tmp, path)?;
        Ok(())
    }
}

pub struct Wasms {
    pub piece: Vec<u8>,
    pub collection: Vec<u8>,
    pub publisher: Vec<u8>,
    pub mock_ft: Vec<u8>,
}

impl Wasms {
    pub fn load() -> Self {
        Self { piece: tests::wasm("piece"), collection: tests::wasm("collection"), publisher: tests::wasm("publisher"), mock_ft: tests::wasm("mock_ft") }
    }
}

pub fn sha256(b: &[u8]) -> [u8; 32] {
    use sha2::Digest;
    sha2::Sha256::digest(b).into()
}

/// One account the deploy creates, with the NEAR it is given.
#[derive(Clone, Debug)]
pub struct Line {
    pub role: &'static str,
    pub account: String,
    pub near: u128,
    pub why: String,
}

/// Every account and the NEAR each one needs. The sum (+ a fee margin) is what the owner must hold.
pub fn budget(owner: &str, o: &Options, w: &Wasms) -> Vec<Line> {
    let v = &o.version;
    let name = |s: &str| format!("soulprint-{v}-{s}.{owner}");
    let mut lines = vec![];
    if !o.skip_publish {
        lines.push(Line {
            role: "publisher",
            account: name("pub"),
            near: GLOBAL_FACTOR * w.piece.len() as u128 * BYTE + w.publisher.len() as u128 * BYTE + NEAR,
            why: format!("global piece code: 10 × {} bytes burnt, + own code, + fees", w.piece.len()),
        });
    }
    lines.extend([
        Line {
            role: "collection",
            account: format!("soulprint-{v}.{owner}"),
            near: w.collection.len() as u128 * BYTE + NEAR / 5 + o.collection_free,
            why: format!("code {} bytes + state + {} free (refund cover, review I4)", w.collection.len(), fmt_near(o.collection_free)),
        },
        Line { role: "evidence", account: name("evidence"), near: 2 * NEAR, why: "sends anchors and attestations (A35)".into() },
        Line { role: "relayer", account: name("relayer"), near: 5 * NEAR, why: "pays fees and capped deposits for users".into() },
    ]);
    if o.usdc.is_none() {
        lines.push(Line {
            role: "usdc",
            account: name("usdc"),
            near: w.mock_ft.len() as u128 * BYTE + NEAR / 2,
            why: format!("test USDC code {} bytes + state", w.mock_ft.len()),
        });
    }
    if o.demo_accounts {
        for (role, n) in [("artist", 2), ("client", 3), ("buyer", 3), ("arbitrator", 1), ("fallback_arbitrator", 1)] {
            lines.push(Line { role, account: name(&role.replace('_', "-")), near: n * NEAR, why: "demo account".into() });
        }
    }
    lines
}

pub const FEE_MARGIN: u128 = NEAR;

pub fn fmt_near(y: u128) -> String {
    format!("{}.{:03} NEAR", y / NEAR, (y % NEAR) / 10u128.pow(21))
}

fn sub_name<'a>(full: &'a str, owner: &str) -> Result<&'a str> {
    full.strip_suffix(&format!(".{owner}")).ok_or_else(|| anyhow!("{full} is not a sub-account of {owner}"))
}

fn ok(r: near_workspaces::result::ExecutionFinalResult, what: &str) -> Result<near_workspaces::result::ExecutionFinalResult> {
    if r.is_success() && r.receipt_failures().is_empty() {
        Ok(r)
    } else {
        bail!("{what} failed: {:#?}\nlogs: {:?}", r.receipt_failures(), r.logs())
    }
}

pub struct Deployed {
    pub entry: Value,
    pub state: State,
}

/// Run (or resume) the deploy. `save` is called after every step with the updated state.
pub async fn deploy<N: Network + 'static>(
    worker: &Worker<N>,
    owner: &Account,
    o: &Options,
    w: &Wasms,
    mut st: State,
    save: &dyn Fn(&State) -> Result<()>,
    log: &dyn Fn(&str),
) -> Result<Deployed> {
    let owner_id = owner.id().to_string();
    let lines = budget(&owner_id, o, w);
    let collection: AccountId = format!("soulprint-{}.{owner_id}", o.version).parse()?;
    if !st.collection.is_empty() && st.collection != collection.as_str() {
        bail!("state file belongs to {}, not {collection}", st.collection);
    }
    st.collection = collection.to_string();
    let time = o.time()?;
    let piece_hash = sha256(&w.piece);

    // Preflight: the owner holds enough for every step not yet done.
    let need: u128 = lines.iter().filter(|l| !st.is_done(&format!("create:{}", l.role))).map(|l| l.near).sum::<u128>() + FEE_MARGIN;
    let have = worker.view_account(owner.id()).await?.balance.as_yoctonear();
    log(&format!("owner {owner_id}: has {}, needs {}", fmt_near(have), fmt_near(need)));
    if have < need {
        bail!("owner {owner_id} holds {} but this deploy needs {} — fund it and re-run (progress is kept)", fmt_near(have), fmt_near(need));
    }
    if !st.is_done("create:collection") && worker.view_account(&collection).await.is_ok() {
        bail!("{collection} already exists; pick another --version");
    }

    // Seeds the evidence service needs (A7 verifier key, blob master key).
    if st.verifier_seed_hex.is_empty() {
        st.verifier_seed_hex = hex::encode(rand::random::<[u8; 32]>());
        st.evidence_master_key_hex = hex::encode(rand::random::<[u8; 32]>());
        save(&st)?;
    }
    let verifier = ed25519_dalek::SigningKey::from_bytes(&hex::decode(&st.verifier_seed_hex)?.try_into().map_err(|_| anyhow!("bad verifier seed"))?);


    // 1. Keyed accounts (everything except the collection, which never gets a key).
    let mut acc: BTreeMap<String, Account> = BTreeMap::new();
    for l in lines.iter().filter(|l| l.role != "collection") {
        let step = format!("create:{}", l.role);
        let sk: SecretKey = match st.keys.get(l.role) {
            Some(k) => k.parse().map_err(|e| anyhow!("stored key for {}: {e:?}", l.role))?,
            None => {
                let k = SecretKey::from_random(KeyType::ED25519);
                st.keys.insert(l.role.into(), k.to_string());
                st.accounts.insert(l.role.into(), l.account.clone());
                save(&st)?; // the key is on disk before the account exists: a crash never strands NEAR
                k
            }
        };
        let id: AccountId = l.account.parse()?;
        if !st.is_done(&step) {
            if worker.view_account(&id).await.is_ok() {
                bail!("{id} already exists but this state did not create it");
            }
            log(&format!("creating {id} with {} — {}", fmt_near(l.near), l.why));
            let r = owner
                .create_subaccount(sub_name(&l.account, &owner_id)?)
                .keys(sk.clone())
                .initial_balance(NearToken::from_yoctonear(l.near))
                .transact()
                .await?;
            let _ = ok(r.details, &format!("create {id}"))?;
            st.mark(&step);
            save(&st)?;
        }
        acc.insert(l.role.into(), Account::from_secret_key(id, sk, worker));
    }

    // 2. Global piece code by hash (S1).
    if o.skip_publish && !st.is_done("publish") {
        log("--skip-publish: using the global piece code already published under this hash");
        st.piece_code_hash_hex = hex::encode(piece_hash);
        st.mark("publish");
        save(&st)?;
    }
    if !st.is_done("publish") {
        log(&format!("publishing piece code ({} bytes) as a global contract", w.piece.len()));
        let p = &acc["publisher"];
        p.deploy(&w.publisher).await?.into_result().map_err(|e| anyhow!("deploy publisher: {e:?}"))?;
        let v = worker.view_account(p.id()).await?;
        log(&format!("publisher holds {} (storage {} bytes) before publishing", fmt_near(v.balance.as_yoctonear()), v.storage_usage));
        // 300 Tgas, not max_gas(): near-workspaces' max is 1 PGas, prepaid at the pessimistic gas
        // price, which locks ~0.6 NEAR and made a 0.6 NEAR margin fail LackBalanceForState.
        let r = ok(p.call(p.id(), "publish").args(w.piece.clone()).gas(Gas::from_tgas(300)).transact().await?, "publish")?;
        let got: Vec<u8> = r.raw_bytes()?;
        if got != piece_hash {
            bail!("publisher returned hash {} but the piece wasm hashes to {}", hex::encode(got), hex::encode(piece_hash));
        }
        // Global code is distributed to all shards asynchronously.
        log("waiting for global code distribution");
        tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        st.piece_code_hash_hex = hex::encode(piece_hash);
        st.mark("publish");
        save(&st)?;
    }

    // 3. Test USDC (S5), unless an existing token was given.
    let usdc: AccountId = match &o.usdc {
        Some(t) => t.clone(),
        None => {
            let u = &acc["usdc"];
            if !st.is_done("usdc") {
                log("deploying test USDC (6 decimals, open faucet)");
                u.deploy(&w.mock_ft).await?.into_result().map_err(|e| anyhow!("deploy usdc: {e:?}"))?;
                let _ = ok(
                    u.call(u.id(), "new").args_json(json!({ "owner": owner.id(), "decimals": 6, "symbol": "USDC" })).transact().await?,
                    "usdc new",
                )?;
                st.mark("usdc");
                save(&st)?;
            }
            u.id().clone()
        }
    };
    st.usdc = usdc.to_string();
    let currencies = tests::currencies(&usdc);

    // 4. The collection: one transaction, no AddKey (A5).
    if !st.is_done("create:collection") {
        let line = lines.iter().find(|l| l.role == "collection").unwrap();
        let governance = o.governance.clone().unwrap_or_else(|| owner.id().clone());
        let init = json!({
            "governance": governance,
            "currencies": currencies,
            "network": o.network_id,
            "time": time,
            "initial_verifier_keys": [tests::ed_pk(&verifier)],
        });
        st.start_block = worker.view_block().await?.height();
        save(&st)?;
        log(&format!("genesis: creating {collection} keylessly with {}", fmt_near(line.near)));
        let r = ok(
            owner
                .batch(&collection)
                .create_account()
                .transfer(NearToken::from_yoctonear(line.near))
                .deploy(&w.collection)
                .call(near_workspaces::operations::Function::new("new").args_json(init).gas(Gas::from_tgas(100)))
                .transact()
                .await?,
            "genesis",
        )?;
        st.genesis_tx = r.outcome().transaction_hash.to_string();
        st.mark("create:collection");
        save(&st)?;
    }

    // 5. Verify: zero keys, the code we built, the piece hash we published.
    let keys = worker.view_access_keys(&collection).await?;
    if !keys.is_empty() {
        bail!("{collection} has {} access key(s) — it must have none", keys.len());
    }
    let code = worker.view_code(&collection).await?;
    let code_hash = sha256(&code);
    if code_hash != sha256(&w.collection) {
        bail!("{collection} code hash {} does not match contracts/res/collection.wasm", hex::encode(code_hash));
    }
    st.collection_code_hash_hex = hex::encode(code_hash);
    let info: Value = worker.view(&collection, "collection_info").args_json(json!({})).await?.json()?;
    log(&format!("verified: {collection} has 0 access keys, code sha256 {}", st.collection_code_hash_hex));

    // 6. Smoke: a real piece account from the global code.
    if o.smoke && !st.is_done("smoke") {
        let artist = acc.get("artist").ok_or_else(|| anyhow!("--smoke needs --demo-accounts"))?;
        let cost: String = worker
            .view(&collection, "piece_creation_cost")
            .args_json(json!({ "currency": "Near" }))
            .await?
            .json()?;
        let next = info["next_token_id"].as_str().unwrap_or("1").to_string();
        let kind = common::PieceKind::Standalone(common::StandaloneTerms {
            currency: common::Currency::Near,
            royalty_bps: common::DEFAULT_ROYALTY_BPS,
            grant: common::Grant { kind: common::GrantType::Personal, attribution: true, transferable: true },
            licence_text_hash: common::Bytes32([0; 32]),
        });
        let capture = ed25519_dalek::SigningKey::from_bytes(&rand::random::<[u8; 32]>());
        log("smoke: demo artist creates a standalone piece");
        let r = ok(
            artist
                .call(&collection, "create_piece")
                .args_json(json!({ "kind": kind, "capture_pubkey": tests::ed_pk(&capture) }))
                .deposit(NearToken::from_yoctonear(cost.parse()?))
                .max_gas()
                .transact()
                .await?,
            "smoke create_piece",
        )?;
        if !r.logs().iter().any(|l| l.contains("piece_created")) {
            bail!("smoke: no piece_created event: {:?}", r.logs());
        }
        let piece: AccountId = format!("p{next}.{collection}").parse()?;
        if !worker.view_access_keys(&piece).await?.is_empty() {
            bail!("smoke: {piece} has access keys");
        }
        let pi: Value = worker.view(&piece, "piece_info").args_json(json!({})).await?.json()?;
        if pi["artist"] != artist.id().as_str() {
            bail!("smoke: {piece} artist is {} not {}", pi["artist"], artist.id());
        }
        log(&format!("smoke: {piece} is live, keyless, artist {}", artist.id()));
        st.smoke_piece = piece.to_string();
        st.mark("smoke");
        save(&st)?;
    }

    let info: Value = worker.view(&collection, "collection_info").args_json(json!({})).await?.json()?;
    let entry = json!({
        "network_id": o.network_id,
        "rpc_url": o.rpc_url,
        "collection": collection,
        "governance": info["governance"],
        "currency_token": usdc,
        "currency_decimals": 6,
        "piece_code_hash": info["piece_code_hash"],
        "piece_code_sha256": st.piece_code_hash_hex,
        "collection_code_sha256": st.collection_code_hash_hex,
        "genesis_tx": st.genesis_tx,
        "time_preset": o.time_name,
        "time": info["time"],
        "currencies": info["currencies"],
        "start_block": st.start_block,
        "evidence_account": st.accounts.get("evidence"),
        "relayer_account": st.accounts.get("relayer"),
        "evidence_recipient": "soulprint-evidence",
        "verifier_key_id": 1,
    });
    Ok(Deployed { entry, state: st })
}

/// Shell `export` lines for the three services (secrets: keep the file 0600).
pub fn services_env(entry: &Value, st: &State) -> String {
    let s = |v: &Value| v.as_str().unwrap_or_default().to_string();
    let min_income: serde_json::Map<String, Value> = entry["currencies"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|c| {
            let k = if c["currency"] == "Near" { "Near".to_string() } else { s(&c["currency"]["Ft"]) };
            (k, c["min_income"].clone())
        })
        .collect();
    let mut out = String::from("# Soulprint services — generated by soulprint-deploy. Contains secret keys.\n");
    let mut kv = |k: &str, v: String| out.push_str(&format!("export {k}='{v}'\n"));
    kv("NEAR_NETWORK", s(&entry["network_id"]));
    kv("NEAR_RPC_URL", s(&entry["rpc_url"]));
    kv("SOULPRINT_COLLECTION", s(&entry["collection"]));
    kv("CURRENCY_TOKEN", s(&entry["currency_token"]));
    kv("START_BLOCK", entry["start_block"].to_string());
    kv("MIN_INCOME_JSON", Value::Object(min_income).to_string());
    kv("EVIDENCE_ACCOUNT_ID", st.accounts.get("evidence").cloned().unwrap_or_default());
    kv("EVIDENCE_SECRET_KEY", st.keys.get("evidence").cloned().unwrap_or_default());
    kv("EVIDENCE_VERIFIER_SEED", st.verifier_seed_hex.clone());
    kv("EVIDENCE_VERIFIER_KEY_ID", "1".into());
    kv("EVIDENCE_MASTER_KEY", st.evidence_master_key_hex.clone());
    kv("RELAYER_ACCOUNT_ID", st.accounts.get("relayer").cloned().unwrap_or_default());
    kv("RELAYER_SECRET_KEY", st.keys.get("relayer").cloned().unwrap_or_default());
    out
}

/// Insert `entry` under `network` in networks.json, keeping other networks (write-then-rename).
pub fn write_network_entry(path: &Path, network: &str, entry: Value) -> Result<()> {
    let mut all: serde_json::Map<String, Value> = match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).with_context(|| format!("{} is not JSON", path.display()))?,
        Err(_) => Default::default(),
    };
    all.insert(network.into(), entry);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&Value::Object(all))? + "\n")?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// The testnet path end to end on a throwaway local sandbox (owner funded with 200 NEAR, demo
/// accounts and smoke on), then a second run on the saved state that must change nothing.
/// Files (state, networks.json, services.env) go to a temp dir, returned.
pub async fn dry_run_sandbox(
    mut o: Options,
    log: &dyn Fn(&str),
) -> Result<(Deployed, std::path::PathBuf, Worker<near_workspaces::network::Sandbox>)> {
    o.network_id = "sandbox".into();
    o.demo_accounts = true;
    o.smoke = true;
    let worker = near_workspaces::sandbox_with_version("2.14.0").await?;
    o.rpc_url = worker.rpc_addr();
    let owner = worker
        .root_account()?
        .create_subaccount("owner")
        .initial_balance(NearToken::from_near(200))
        .transact()
        .await?
        .into_result()?;
    let w = Wasms::load();
    let dir = std::env::temp_dir().join(format!("soulprint-dry-run-{}-{}", std::process::id(), rand::random::<u32>()));
    let state_path = dir.join("state.json");
    let save = |s: &State| s.save(&state_path);
    let d = deploy(&worker, &owner, &o, &w, State::default(), &save, log).await?;
    let again = deploy(&worker, &owner, &o, &w, State::load(&state_path)?.context("state not saved")?, &save, log).await?;
    if again.state.genesis_tx != d.state.genesis_tx || again.state.done != d.state.done {
        bail!("resume changed the deploy");
    }
    write_network_entry(&dir.join("networks.json"), "sandbox", d.entry.clone())?;
    std::fs::write(dir.join("services.env"), services_env(&d.entry, &d.state))?;
    Ok((d, dir, worker))
}
