//! Sandbox harness. `world()` boots near-sandbox and stands up the whole system the way the
//! deploy does: publish the piece wasm as a global contract by hash, create the collection
//! keylessly in one transaction (A5), deploy mock USDC and an evil receiver, fund actors.
//! Requires `scripts/build.sh` to have produced `contracts/res/*.wasm`.

use anyhow::{anyhow, bail, Result};
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};

pub use common;

pub const SEC: u64 = 1_000_000_000;
pub const USDC: u128 = 1_000_000; // 6 decimals
pub const NEAR: u128 = 10u128.pow(24);

pub fn wasm(name: &str) -> Vec<u8> {
    let p = format!("{}/../res/{name}.wasm", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&p).unwrap_or_else(|e| panic!("{p}: {e} — run scripts/build.sh first"))
}

pub struct World {
    pub worker: Worker<Sandbox>,
    pub root: Account,
    pub collection: AccountId,
    pub usdc: Contract,
    pub evil: Contract,
    pub gov: Account,
    pub svc: Account,
    pub artist: Account,
    pub client: Account,
    pub buyer: Account,
    pub buyer2: Account,
    pub shop: Account,
    pub arb: Account,
    pub fallback: Account,
    pub verifier: ed25519_dalek::SigningKey,
    pub capture: ed25519_dalek::SigningKey,
    pub piece_code_hash: [u8; 32],
    pub time: common::TimeConfig,
}

pub fn sdk_id(a: &AccountId) -> near_sdk::AccountId {
    a.as_str().parse().unwrap()
}
pub fn ws_id(a: &str) -> AccountId {
    a.parse().unwrap()
}

/// A successful outcome (not `must_use`, so `ok(..)?;` reads cleanly).
pub struct Out(pub ExecutionFinalResult);
impl std::ops::Deref for Out {
    type Target = ExecutionFinalResult;
    fn deref(&self) -> &ExecutionFinalResult {
        &self.0
    }
}

/// Fail with the receipt failures and logs if the outcome is not a success.
pub fn ok(r: ExecutionFinalResult) -> Result<Out> {
    if r.is_success() && r.receipt_failures().is_empty() {
        Ok(Out(r))
    } else {
        bail!("call failed: {:#?}\nlogs: {:?}", r.receipt_failures(), r.logs())
    }
}

/// The transaction's own call succeeded; inner receipts (e.g. a refused `ft_transfer` that the
/// piece then restores) may have failed by design.
pub fn landed(r: ExecutionFinalResult) -> Result<Out> {
    if r.is_success() {
        Ok(Out(r))
    } else {
        bail!("call failed: {:#?}\nlogs: {:?}", r.receipt_failures(), r.logs())
    }
}

/// The call must fail and the failure must mention `needle`.
pub fn fails_with(r: ExecutionFinalResult, needle: &str) -> Result<()> {
    let text = format!("{:?}", r.receipt_failures());
    if r.is_success() && r.receipt_failures().is_empty() {
        bail!("expected failure containing {needle}, got success; logs {:?}", r.logs());
    }
    if !text.contains(needle) && !format!("{r:?}").contains(needle) {
        bail!("expected failure containing {needle}, got {text}");
    }
    Ok(())
}

pub fn ed_pk(sk: &ed25519_dalek::SigningKey) -> near_sdk::PublicKey {
    common::ed25519_pk(&common::Bytes32(sk.verifying_key().to_bytes()))
}

pub fn currencies(usdc: &AccountId) -> Vec<common::CurrencyConfig> {
    use common::{Currency, CurrencyConfig};
    use near_sdk::json_types::U128;
    vec![
        CurrencyConfig {
            currency: Currency::Near,
            decimals: 24,
            min_price: U128(NEAR / 10),
            min_list: U128(NEAR / 10),
            min_income: U128(NEAR / 1000),
            badge_min: U128(NEAR),
        },
        CurrencyConfig {
            currency: Currency::Ft(sdk_id(usdc)),
            decimals: 6,
            min_price: U128(USDC),
            min_list: U128(USDC / 10),
            min_income: U128(USDC / 100),
            badge_min: U128(20 * USDC),
        },
    ]
}

impl World {
    pub async fn new() -> Result<Self> {
        let worker = near_workspaces::sandbox_with_version("2.14.0").await?;
        let root = worker.root_account()?;
        let make = |name: &'static str, near: u128| {
            let root = root.clone();
            async move {
                root.create_subaccount(name)
                    .initial_balance(NearToken::from_near(near))
                    .transact()
                    .await?
                    .into_result()
                    .map_err(|e| anyhow!("{e:?}"))
            }
        };

        // 1. Publish the piece code globally by hash (S1). Burns 10× storage from the publisher.
        let piece_wasm = wasm("piece");
        let piece_code_hash: [u8; 32] = {
            use sha2::Digest;
            sha2::Sha256::digest(&piece_wasm).into()
        };
        let publisher = make("publisher", 100).await?;
        let publisher = publisher.deploy(&wasm("publisher")).await?.into_result()?;
        ok(publisher.call("publish").args(piece_wasm).max_gas().transact().await?)?;
        // Global code is distributed to all shards asynchronously.
        worker.fast_forward(5).await?;

        // 2. Actors.
        let gov = make("gov", 20).await?;
        let svc = make("svc", 20).await?;
        let artist = make("artist", 50).await?;
        let client = make("client", 50).await?;
        let buyer = make("buyer", 50).await?;
        let buyer2 = make("buyer2", 50).await?;
        let shop = make("shop", 50).await?;
        let arb = make("arb", 10).await?;
        let fallback = make("fallback", 10).await?;

        // 3. Mock USDC + evil receiver.
        let usdc_acc = make("usdc", 20).await?;
        let usdc = usdc_acc.deploy(&wasm("mock_ft")).await?.into_result()?;
        ok(usdc.call("new").args_json(json!({ "owner": usdc.id(), "decimals": 6, "symbol": "USDC" })).transact().await?)?;
        let evil_acc = make("evil", 20).await?;
        let evil = evil_acc.deploy(&wasm("evil_receiver")).await?.into_result()?;

        // 4. Collection: one transaction, no AddKey (A5).
        let verifier = ed25519_dalek::SigningKey::from_bytes(&[77u8; 32]);
        let capture = ed25519_dalek::SigningKey::from_bytes(&[42u8; 32]);
        let time = common::TimeConfig::fast();
        let collection: AccountId = format!("soulprint.{}", root.id()).parse()?;
        let init = json!({
            "governance": gov.id(),
            "currencies": currencies(usdc.id()),
            "network": "sandbox",
            "time": time,
            "initial_verifier_keys": [ed_pk(&verifier)],
        });
        ok(root
            .batch(&collection)
            .create_account()
            .transfer(NearToken::from_near(10))
            .deploy(&wasm("collection"))
            .call(near_workspaces::operations::Function::new("new").args_json(init).gas(Gas::from_tgas(100)))
            .transact()
            .await?)?;

        let w = Self {
            worker,
            root,
            collection,
            usdc,
            evil,
            gov,
            svc,
            artist,
            client,
            buyer,
            buyer2,
            shop,
            arb,
            fallback,
            verifier,
            capture,
            piece_code_hash,
            time,
        };
        for a in [&w.artist, &w.client, &w.buyer, &w.buyer2, &w.shop, &w.arb, &w.fallback] {
            w.faucet(a, 1000 * USDC).await?;
        }
        Ok(w)
    }

    pub async fn now(&self) -> Result<u64> {
        Ok(self.worker.view_block().await?.timestamp())
    }

    /// Advance chain time by at least `secs` seconds.
    pub async fn sleep(&self, secs: u64) -> Result<()> {
        let target = self.now().await? + secs * SEC;
        for _ in 0..200 {
            if self.now().await? >= target {
                return Ok(());
            }
            self.worker.fast_forward(10).await?;
        }
        bail!("time did not advance")
    }

    pub async fn faucet(&self, who: &Account, amount: u128) -> Result<()> {
        ok(who.call(self.usdc.id(), "faucet").args_json(json!({ "amount": amount.to_string() })).transact().await?)?;
        Ok(())
    }

    pub async fn usdc_balance(&self, who: &AccountId) -> Result<u128> {
        let v: String = self.usdc.view("ft_balance_of").args_json(json!({ "account_id": who })).await?.json()?;
        Ok(v.parse()?)
    }

    pub fn piece_id(&self, token_id: &str) -> AccountId {
        format!("p{token_id}.{}", self.collection).parse().unwrap()
    }

    pub async fn view(&self, contract: &AccountId, method: &str, args: Value) -> Result<Value> {
        Ok(self.worker.view(contract, method).args_json(args).await?.json()?)
    }

    pub async fn info(&self, piece: &AccountId) -> Result<Value> {
        self.view(piece, "piece_info", json!({})).await
    }

    pub async fn accounting(&self, piece: &AccountId) -> Result<Value> {
        self.view(piece, "accounting", json!({})).await
    }

    pub async fn creation_cost(&self, ft: bool) -> Result<u128> {
        let cur = if ft { json!({ "Ft": self.usdc.id() }) } else { json!("Near") };
        let v: String = self.view(&self.collection, "piece_creation_cost", json!({ "currency": cur })).await?.as_str().unwrap().to_string();
        Ok(v.parse()?)
    }

    /// Commission terms relative to chain time. `ft` = USDC, else NEAR.
    pub async fn terms(&self, ft: bool, price: u128, deadline_secs: u64) -> Result<common::Terms> {
        use common::*;
        use near_sdk::json_types::{U128, U64};
        let now = self.now().await?;
        Ok(Terms {
            price: U128(price),
            currency: if ft { Currency::Ft(sdk_id(self.usdc.id())) } else { Currency::Near },
            milestones: vec![Milestone { bps: 3000 }, Milestone { bps: 7000 }],
            deadline_ns: U64(now + deadline_secs * SEC),
            grace_ns: U64(2 * SEC),
            review_window_ns: U64(self.time.review_min),
            revision_period_ns: U64(self.time.revision_period_min),
            revision_rounds: 2,
            arbitrator: sdk_id(self.arb.id()),
            fallback_arbitrator: sdk_id(self.fallback.id()),
            timeout_artist_bps: DEFAULT_TIMEOUT_ARTIST_BPS,
            reject_bond_bps: DEFAULT_REJECT_BOND_BPS,
            royalty_bps: DEFAULT_ROYALTY_BPS,
            grant: Grant { kind: GrantType::CommercialNonExclusive, attribution: true, transferable: true },
            licence_text_hash: Bytes32([7; 32]),
            client: Some(sdk_id(self.client.id())),
        })
    }

    /// Artist creates a piece; returns its token id.
    pub async fn create(&self, kind: common::PieceKind) -> Result<String> {
        let ft = matches!(
            &kind,
            common::PieceKind::Commission(t) if matches!(t.currency, common::Currency::Ft(_))
        ) || matches!(&kind, common::PieceKind::Standalone(s) if matches!(s.currency, common::Currency::Ft(_)));
        let cost = self.creation_cost(ft).await?;
        let before: Value = self.view(&self.collection, "collection_info", json!({})).await?;
        let r = ok(self
            .artist
            .call(&self.collection, "create_piece")
            .args_json(json!({ "kind": kind, "capture_pubkey": ed_pk(&self.capture) }))
            .deposit(NearToken::from_yoctonear(cost))
            .max_gas()
            .transact()
            .await?)?;
        let id = before["next_token_id"].as_str().unwrap().to_string();
        if !r.logs().iter().any(|l| l.contains("piece_created")) {
            bail!("piece not created: {:?}", r.logs());
        }
        Ok(id)
    }

    pub async fn commission(&self, ft: bool, price: u128) -> Result<(String, AccountId, common::Terms)> {
        let t = self.terms(ft, price, 600).await?;
        let id = self.create(common::PieceKind::Commission(t.clone())).await?;
        Ok((id.clone(), self.piece_id(&id), t))
    }

    /// Client funds (FT via ft_transfer_call, NEAR via attached deposit).
    pub async fn fund(&self, piece: &AccountId, t: &common::Terms, payer: &Account) -> Result<ExecutionFinalResult> {
        let h = t.hash();
        match &t.currency {
            common::Currency::Ft(_) => self
                .ft_action(payer, piece, t.price.0, json!({ "action": "fund", "expected_terms_hash": h }))
                .await,
            common::Currency::Near => Ok(payer
                .call(piece, "fund")
                .args_json(json!({ "expected_terms_hash": h }))
                .deposit(NearToken::from_yoctonear(t.price.0))
                .max_gas()
                .transact()
                .await?),
        }
    }

    pub async fn ft_action(&self, payer: &Account, piece: &AccountId, amount: u128, msg: Value) -> Result<ExecutionFinalResult> {
        Ok(payer
            .call(self.usdc.id(), "ft_transfer_call")
            .args_json(json!({ "receiver_id": piece, "amount": amount.to_string(), "msg": msg.to_string() }))
            .deposit(NearToken::from_yoctonear(1))
            .max_gas()
            .transact()
            .await?)
    }

    /// Gated call with 1 yocto.
    pub async fn act(&self, who: &Account, piece: &AccountId, method: &str, args: Value) -> Result<ExecutionFinalResult> {
        Ok(who.call(piece, method).args_json(args).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?)
    }

    pub async fn deliver(&self, piece: &AccountId) -> Result<()> {
        let h = common::Bytes32([0xf1; 32]);
        ok(self.act(&self.artist, piece, "deliver", json!({ "final_file_hash": h, "report_hash": h })).await?)?;
        Ok(())
    }

    /// Created, funded, delivered, accepted.
    pub async fn settled(&self, ft: bool, price: u128) -> Result<(String, AccountId)> {
        // Created, funded by the client, delivered, accepted: the client owns it.
        let (id, piece, t) = self.commission(ft, price).await?;
        ok(self.fund(&piece, &t, &self.client).await?)?;
        self.deliver(&piece).await?;
        ok(self.act(&self.client, &piece, "accept", json!({})).await?)?;
        Ok((id, piece))
    }

    pub async fn credit(&self, piece: &AccountId, who: &AccountId) -> Result<(u128, u128)> {
        let a = self.accounting(piece).await?;
        for c in a["credits"].as_array().unwrap() {
            if c["account"] == who.as_str() {
                return Ok((c["available"].as_str().unwrap().parse()?, c["in_flight"].as_str().unwrap().parse()?));
            }
        }
        Ok((0, 0))
    }

    pub async fn index_owner(&self, token_id: &str) -> Result<String> {
        let t = self.view(&self.collection, "nft_token", json!({ "token_id": token_id })).await?;
        Ok(t["owner_id"].as_str().unwrap_or_default().to_string())
    }

    // ---------- resale / income ----------

    pub async fn list(&self, owner: &Account, piece: &AccountId, price: u128) -> Result<u64> {
        ok(self.act(owner, piece, "list", json!({ "price": price.to_string() })).await?)?;
        let l = self.view(piece, "listing", json!({})).await?;
        Ok(l["nonce"].as_str().unwrap().parse()?)
    }

    pub async fn buy_ft(&self, buyer: &Account, piece: &AccountId, price: u128, nonce: u64, pool_min: u128) -> Result<ExecutionFinalResult> {
        let msg = json!({ "action": "buy", "nonce": nonce.to_string(), "max_price": price.to_string(), "expected_pool_min": pool_min.to_string() });
        self.ft_action(buyer, piece, price, msg).await
    }

    pub async fn buy_near(&self, buyer: &Account, piece: &AccountId, price: u128, nonce: u64) -> Result<ExecutionFinalResult> {
        Ok(buyer
            .call(piece, "buy")
            .args_json(json!({ "nonce": nonce.to_string(), "max_price": price.to_string(), "expected_pool_min": "0" }))
            .deposit(NearToken::from_yoctonear(price))
            .max_gas()
            .transact()
            .await?)
    }

    pub async fn pay_income_ft(&self, payer: &Account, piece: &AccountId, amount: u128) -> Result<ExecutionFinalResult> {
        self.ft_action(payer, piece, amount, json!({ "action": "pay_income" })).await
    }

    pub async fn holder_pool(&self, piece: &AccountId) -> Result<u128> {
        Ok(self.accounting(piece).await?["holder_pool"].as_str().unwrap().parse()?)
    }

    pub async fn blacklist(&self, who: &AccountId, on: bool) -> Result<()> {
        ok(self.usdc.call("set_blacklisted").args_json(json!({ "account_id": who, "blocked": on })).transact().await?)?;
        Ok(())
    }

    pub async fn pause_usdc(&self, on: bool) -> Result<()> {
        ok(self.usdc.call("set_paused").args_json(json!({ "paused": on })).transact().await?)?;
        Ok(())
    }

    pub async fn near_balance(&self, id: &AccountId) -> Result<u128> {
        Ok(self.worker.view_account(id).await?.balance.as_yoctonear())
    }

    /// A fresh funded account with no USDC registration.
    pub async fn fresh(&self, name: &str, near: u128) -> Result<Account> {
        self.root
            .create_subaccount(name)
            .initial_balance(NearToken::from_near(near))
            .transact()
            .await?
            .into_result()
            .map_err(|e| anyhow!("{e:?}"))
    }

    /// Standalone piece (artist-owned); settled by the artist.
    pub async fn standalone(&self, ft: bool, royalty_bps: u16, settle: bool) -> Result<(String, AccountId)> {
        use common::*;
        let st = StandaloneTerms {
            currency: if ft { Currency::Ft(sdk_id(self.usdc.id())) } else { Currency::Near },
            royalty_bps,
            grant: Grant { kind: GrantType::CommercialNonExclusive, attribution: true, transferable: true },
            licence_text_hash: Bytes32([9; 32]),
        };
        let id = self.create(PieceKind::Standalone(st)).await?;
        let piece = self.piece_id(&id);
        if settle {
            let h = Bytes32([0xa1; 32]);
            ok(self.act(&self.artist, &piece, "settle_standalone", json!({ "final_file_hash": h, "report_hash": h })).await?)?;
        }
        Ok((id, piece))
    }
}

/// Wait for a transaction submitted with `transact_async` to finish.
pub async fn wait(s: near_workspaces::operations::TransactionStatus) -> Result<ExecutionFinalResult> {
    loop {
        if let std::task::Poll::Ready(r) = s.status().await? {
            return Ok(r);
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

/// Sum of a piece's credits (available + in flight).
pub fn credits_total(acc: &Value) -> u128 {
    acc["credits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["available"].as_str().unwrap().parse::<u128>().unwrap() + c["in_flight"].as_str().unwrap().parse::<u128>().unwrap())
        .sum()
}
