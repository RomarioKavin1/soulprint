//! Plan 1 Task 15 soak: random commission lifecycles on a deployed collection with the demo
//! accounts, then a per-piece reconciliation of the on-chain ledger. The indexer side
//! (events → balances equal `accounting()`) is `services/indexer/test/live.test.ts`, run after.
//!
//! Needs a collection with the `fast` time preset (windows of seconds).

use anyhow::{anyhow, bail, Context, Result};
use near_workspaces::types::{NearToken, SecretKey};
use near_workspaces::{Account, AccountId, Network, Worker};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

use crate::State;

pub const USDC: u128 = 1_000_000;
/// Storage deposit the web app attaches to non-value calls (surplus refunded; Plan 1 C2).
const STORAGE_DEPOSIT: u128 = 10_000_000_000_000_000_000_000;
const SEC: u64 = 1_000_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scenario {
    Accept,
    Changes,
    Split,
    Arbitrator,
    Refund,
    Resale,
}
pub const ALL: [Scenario; 6] = [Scenario::Accept, Scenario::Changes, Scenario::Split, Scenario::Arbitrator, Scenario::Refund, Scenario::Resale];

pub struct Soak<'a, N: Network + 'static> {
    pub worker: &'a Worker<N>,
    pub collection: AccountId,
    pub usdc: AccountId,
    pub artist: Account,
    pub client: Account,
    pub buyer: Account,
    pub arb: Account,
    pub fallback: Account,
    pub log: &'a dyn Fn(&str),
}

fn ok(r: near_workspaces::result::ExecutionFinalResult, what: &str) -> Result<near_workspaces::result::ExecutionFinalResult> {
    if r.is_success() && r.receipt_failures().is_empty() {
        Ok(r)
    } else {
        bail!("{what} failed: {:?}\nlogs: {:?}", r.receipt_failures(), r.logs())
    }
}

fn done(r: near_workspaces::result::ExecutionFinalResult, what: &str) -> Result<()> {
    ok(r, what).map(|_| ())
}

fn account<N: Network + 'static>(st: &State, role: &str, w: &Worker<N>) -> Result<Account> {
    let id: AccountId = st.accounts.get(role).with_context(|| format!("state has no {role} (deploy with --demo-accounts)"))?.parse()?;
    let sk: SecretKey = st.keys.get(role).context("key")?.parse().map_err(|e| anyhow!("{role} key: {e:?}"))?;
    Ok(Account::from_secret_key(id, sk, w))
}

impl<'a, N: Network + 'static> Soak<'a, N> {
    pub fn from_state(worker: &'a Worker<N>, st: &State, log: &'a dyn Fn(&str)) -> Result<Self> {
        Ok(Self {
            worker,
            collection: st.collection.parse()?,
            usdc: st.usdc.parse()?,
            artist: account(st, "artist", worker)?,
            client: account(st, "client", worker)?,
            buyer: account(st, "buyer", worker)?,
            arb: account(st, "arbitrator", worker)?,
            fallback: account(st, "fallback_arbitrator", worker)?,
            log,
        })
    }

    async fn view(&self, c: &AccountId, m: &str, a: Value) -> Result<Value> {
        Ok(self.worker.view(c, m).args_json(a).await?.json()?)
    }
    async fn now(&self) -> Result<u64> {
        Ok(self.worker.view_block().await?.timestamp())
    }
    async fn wait_until(&self, t_ns: u64) -> Result<()> {
        let deadline = Instant::now() + Duration::from_secs(600);
        while self.now().await? < t_ns {
            if Instant::now() > deadline {
                bail!("chain time did not reach {t_ns}");
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        Ok(())
    }
    /// Gated non-value call: 0.01 NEAR storage deposit like the web app.
    async fn act(&self, who: &Account, piece: &AccountId, m: &str, a: Value) -> Result<()> {
        done(who.call(piece, m).args_json(a).deposit(NearToken::from_yoctonear(STORAGE_DEPOSIT)).gas(near_workspaces::types::Gas::from_tgas(300)).transact().await?, m)?;
        Ok(())
    }
    async fn ft(&self, payer: &Account, piece: &AccountId, amount: u128, msg: Value) -> Result<()> {
        done(
            payer
                .call(&self.usdc, "ft_transfer_call")
                .args_json(json!({ "receiver_id": piece, "amount": amount.to_string(), "msg": msg.to_string() }))
                .deposit(NearToken::from_yoctonear(1))
                .gas(near_workspaces::types::Gas::from_tgas(300))
                .transact()
                .await?,
            "ft_transfer_call",
        )?;
        Ok(())
    }
    async fn faucet(&self, who: &Account, amount: u128) -> Result<()> {
        done(who.call(&self.usdc, "faucet").args_json(json!({ "amount": amount.to_string() })).transact().await?, "faucet")?;
        Ok(())
    }
    async fn claim(&self, who: &Account, piece: &AccountId) -> Result<()> {
        // `claim` is not payable (pays out only; nothing grows).
        done(who.call(piece, "claim").gas(near_workspaces::types::Gas::from_tgas(300)).transact().await?, "claim")?;
        Ok(())
    }

    /// Fund every demo account with test USDC once.
    pub async fn prepare(&self) -> Result<()> {
        for a in [&self.client, &self.buyer, &self.artist] {
            self.faucet(a, 1000 * USDC).await?;
        }
        Ok(())
    }

    async fn create(&self, price: u128, deadline_secs: u64) -> Result<(AccountId, common::Terms)> {
        use common::*;
        use near_sdk::json_types::{U128, U64};
        let info = self.view(&self.collection, "collection_info", json!({})).await?;
        let time: TimeConfig = serde_json::from_value(info["time"].clone())?;
        let now = self.now().await?;
        let sdk = |a: &AccountId| -> near_sdk::AccountId { a.as_str().parse().unwrap() };
        let t = Terms {
            price: U128(price),
            currency: Currency::Ft(sdk(&self.usdc)),
            milestones: vec![Milestone { bps: 3000 }, Milestone { bps: 7000 }],
            deadline_ns: U64(now + deadline_secs * SEC),
            grace_ns: U64(2 * SEC),
            review_window_ns: U64(time.review_min),
            revision_period_ns: U64(time.revision_period_min),
            revision_rounds: 2,
            arbitrator: sdk(self.arb.id()),
            fallback_arbitrator: sdk(self.fallback.id()),
            timeout_artist_bps: DEFAULT_TIMEOUT_ARTIST_BPS,
            reject_bond_bps: DEFAULT_REJECT_BOND_BPS,
            royalty_bps: DEFAULT_ROYALTY_BPS,
            grant: Grant { kind: GrantType::CommercialNonExclusive, attribution: true, transferable: true },
            licence_text_hash: Bytes32([7; 32]),
            client: Some(sdk(self.client.id())),
        };
        let cost: String = self.view(&self.collection, "piece_creation_cost", json!({ "currency": { "Ft": self.usdc } })).await?.as_str().unwrap_or("0").to_string();
        let next = info["next_token_id"].as_str().context("next_token_id")?.to_string();
        let capture = ed25519_dalek::SigningKey::from_bytes(&rand::random::<[u8; 32]>());
        let r = ok(
            self.artist
                .call(&self.collection, "create_piece")
                .args_json(json!({ "kind": PieceKind::Commission(t.clone()), "capture_pubkey": tests::ed_pk(&capture) }))
                .deposit(NearToken::from_yoctonear(cost.parse()?))
                .gas(near_workspaces::types::Gas::from_tgas(300))
                .transact()
                .await?,
            "create_piece",
        )?;
        if !r.logs().iter().any(|l| l.contains("piece_created")) {
            bail!("no piece_created: {:?}", r.logs());
        }
        Ok((format!("p{next}.{}", self.collection).parse()?, t))
    }

    async fn deliver(&self, piece: &AccountId) -> Result<()> {
        let h = common::Bytes32(rand::random());
        self.act(&self.artist, piece, "deliver", json!({ "final_file_hash": h, "report_hash": h })).await
    }

    async fn status(&self, piece: &AccountId) -> Result<Value> {
        self.view(piece, "piece_info", json!({})).await
    }

    /// One commission through `s`; every party claims what it is owed at the end.
    pub async fn run(&self, s: Scenario) -> Result<AccountId> {
        let price = (5 + rand::random::<u128>() % 16) * USDC;
        let deadline = if s == Scenario::Refund { 25 } else { 600 };
        let (piece, t) = self.create(price, deadline).await?;
        (self.log)(&format!("{s:?}: {piece} at {} USDC", price / USDC));
        self.ft(&self.client, &piece, price, json!({ "action": "fund", "expected_terms_hash": t.hash() })).await?;
        match s {
            Scenario::Accept | Scenario::Resale => {
                self.deliver(&piece).await?;
                self.act(&self.client, &piece, "accept", json!({})).await?;
                if s == Scenario::Resale {
                    let resale = price + 3 * USDC;
                    self.act(&self.client, &piece, "list", json!({ "price": resale.to_string() })).await?;
                    let l = self.view(&piece, "listing", json!({})).await?;
                    let nonce = l["nonce"].as_str().context("listing nonce")?.to_string();
                    let msg = json!({ "action": "buy", "nonce": nonce, "max_price": resale.to_string(), "expected_pool_min": "0" });
                    self.ft(&self.buyer, &piece, resale, msg).await?;
                    let owner = self.status(&piece).await?["owner"].clone();
                    if owner != self.buyer.id().as_str() {
                        bail!("{piece}: owner after buy is {owner}");
                    }
                }
            }
            Scenario::Changes => {
                self.deliver(&piece).await?;
                self.act(&self.client, &piece, "request_changes", json!({})).await?;
                self.deliver(&piece).await?;
                self.act(&self.client, &piece, "accept", json!({})).await?;
            }
            Scenario::Split | Scenario::Arbitrator => {
                self.deliver(&piece).await?;
                let bond = price * common::DEFAULT_REJECT_BOND_BPS as u128 / common::BPS_DENOM as u128;
                self.ft(&self.client, &piece, bond, json!({ "action": "reject" })).await?;
                if s == Scenario::Split {
                    self.act(&self.artist, &piece, "propose_split", json!({ "artist_bps": 6000 })).await?;
                    let nonce = self.status(&piece).await?["split"]["nonce"].as_u64().context("split nonce")?;
                    self.act(&self.client, &piece, "accept_split", json!({ "expected_artist_bps": 6000, "proposal_nonce": nonce })).await?;
                } else {
                    let info = self.view(&self.collection, "collection_info", json!({})).await?;
                    let negotiation: u64 = info["time"]["negotiation"].as_str().context("time")?.parse()?;
                    let now = self.now().await?;
                    self.wait_until(now + negotiation + 2 * SEC).await?;
                    self.act(&self.arb, &piece, "resolve", json!({ "artist_bps": 5000 })).await?;
                }
            }
            Scenario::Refund => {
                self.wait_until(t.deadline_ns.0 + t.grace_ns.0 + 2 * SEC).await?;
                self.act(&self.client, &piece, "claim_refund", json!({})).await?;
            }
        }
        // Everyone with a credit claims it.
        let acc = self.view(&piece, "accounting", json!({})).await?;
        for c in acc["credits"].as_array().into_iter().flatten() {
            if c["available"].as_str().unwrap_or("0") == "0" {
                continue;
            }
            let who = c["account"].as_str().unwrap_or_default();
            let a = [&self.artist, &self.client, &self.buyer].into_iter().find(|a| a.id().as_str() == who);
            if let Some(a) = a {
                self.claim(a, &piece).await?;
            }
        }
        Ok(piece)
    }

    /// I1 on chain: the piece holds at least its liabilities; money in = money settled + held.
    pub async fn reconcile(&self, piece: &AccountId) -> Result<()> {
        let a = self.view(piece, "accounting", json!({})).await?;
        let n = |k: &str| -> Result<u128> { a[k].as_str().with_context(|| format!("{piece}: no {k}"))?.parse::<u128>().map_err(Into::into) };
        let held: String = self.view(&self.usdc, "ft_balance_of", json!({ "account_id": piece })).await?.as_str().unwrap_or("0").to_string();
        let held: u128 = held.parse()?;
        if held < n("liabilities")? {
            bail!("{piece}: holds {held} < liabilities {}", n("liabilities")?);
        }
        if n("funded")? != n("released")? + n("refunded")? + n("escrow")? {
            bail!("{piece}: funded {} != released {} + refunded {} + escrow {}", n("funded")?, n("released")?, n("refunded")?, n("escrow")?);
        }
        let in_flight: u128 = a["credits"].as_array().into_iter().flatten().map(|c| c["in_flight"].as_str().unwrap_or("0").parse::<u128>().unwrap_or(0)).sum();
        if in_flight != 0 {
            bail!("{piece}: {in_flight} still in flight after the run");
        }
        Ok(())
    }
}

/// Run `n` lifecycles (cycling through every scenario, shuffled) spread over at least `min_secs`.
pub async fn soak<N: Network + 'static>(s: &Soak<'_, N>, n: usize, min_secs: u64) -> Result<Vec<(Scenario, AccountId)>> {
    s.prepare().await?;
    let start = Instant::now();
    let mut order: Vec<Scenario> = (0..n).map(|i| ALL[i % ALL.len()]).collect();
    for i in (1..order.len()).rev() {
        order.swap(i, rand::random::<usize>() % (i + 1));
    }
    let gap = Duration::from_secs(min_secs / n.max(1) as u64);
    let mut done = vec![];
    for (i, sc) in order.into_iter().enumerate() {
        let t0 = Instant::now();
        let piece = s.run(sc).await.with_context(|| format!("lifecycle {} ({sc:?})", i + 1))?;
        s.reconcile(&piece).await?;
        done.push((sc, piece));
        (s.log)(&format!("{}/{n} ok in {:.0?} (elapsed {:.0?})", i + 1, t0.elapsed(), start.elapsed()));
        if let Some(rest) = gap.checked_sub(t0.elapsed()) {
            tokio::time::sleep(rest).await;
        }
    }
    // Final pass: every piece still reconciles after all later activity.
    for (_, p) in &done {
        s.reconcile(p).await?;
    }
    Ok(done)
}
