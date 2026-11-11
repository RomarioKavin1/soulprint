//! Model-based fuzzer (Plan 1 Task 11): random action sequences against `PieceCore` with a
//! simulated currency ledger and an in-flight payout queue delivered in random order.
//! Invariants I1–I6 (DESIGN §8) are checked after every step.
use common::*;
use near_sdk::AccountId;
use piece::core::*;
use proptest::prelude::*;
use std::sync::Mutex;

/// Successful steps per op kind (printed with MODEL_STATS=1) — shows the fuzzer reaches deep states.
static STATS: Mutex<Vec<(String, usize)>> = Mutex::new(Vec::new());
fn count(name: &str) {
    let mut s = STATS.lock().unwrap();
    match s.iter_mut().find(|(n, _)| n == name) {
        Some(e) => e.1 += 1,
        None => s.push((name.to_string(), 1)),
    }
}

const SEC: u64 = 1_000_000_000;
const DAY: u64 = 86_400 * SEC;
const T0: u64 = 1_800_000_000_000_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn actors() -> Vec<AccountId> {
    ["artist.near", "client.near", "buyer.near", "buyer2.near", "arb.near", "fallback.near", "stranger.near", "soulprint-v1.near"]
        .iter()
        .map(|s| acc(s))
        .collect()
}
fn usdc() -> AccountId {
    acc("usdc.near")
}

fn currency(ft: bool) -> CurrencyConfig {
    if ft {
        CurrencyConfig {
            currency: Currency::Ft(usdc()),
            decimals: 6,
            min_price: 1_000_000u128.into(),
            min_list: 100_000u128.into(),
            min_income: 10_000u128.into(),
            badge_min: 20_000_000u128.into(),
        }
    } else {
        CurrencyConfig {
            currency: Currency::Near,
            decimals: 24,
            min_price: 10u128.pow(23).into(),
            min_list: 10u128.pow(23).into(),
            min_income: 10u128.pow(21).into(),
            badge_min: 10u128.pow(24).into(),
        }
    }
}
fn unit(ft: bool) -> u128 {
    if ft { 1_000_000 } else { 10u128.pow(24) }
}

fn terms(cur: &CurrencyConfig, ft: bool, named_client: bool) -> Terms {
    Terms {
        price: (100 * unit(ft)).into(),
        currency: cur.currency.clone(),
        milestones: vec![Milestone { bps: 3000 }, Milestone { bps: 7000 }],
        deadline_ns: (T0 + 30 * DAY).into(),
        grace_ns: (2 * DAY).into(),
        review_window_ns: (7 * DAY).into(),
        revision_period_ns: (3 * DAY).into(),
        revision_rounds: 2,
        arbitrator: acc("arb.near"),
        fallback_arbitrator: acc("fallback.near"),
        timeout_artist_bps: DEFAULT_TIMEOUT_ARTIST_BPS,
        reject_bond_bps: DEFAULT_REJECT_BOND_BPS,
        royalty_bps: DEFAULT_ROYALTY_BPS,
        grant: Grant { kind: GrantType::CommercialNonExclusive, attribution: true, transferable: true },
        licence_text_hash: Bytes32([7; 32]),
        client: if named_client { Some(acc("client.near")) } else { None },
    }
}

#[derive(Clone, Copy, Debug)]
enum Dep {
    Zero,
    One,
    Exact,
    Less,
    More,
}

#[derive(Clone, Debug)]
enum Op {
    Fund(Dep, bool),
    Deliver,
    RequestChanges,
    Release(u8),
    Accept,
    Settle,
    ClaimRefund,
    Cancel,
    MutualCancel,
    Extend(u64),
    Reject(Dep),
    ProposeSplit(u16),
    AcceptSplit(bool),
    Resolve(u16),
    TimeoutResolve,
    Claim,
    ClaimTo(usize),
    Withdraw,
    List(u128, bool),
    Delist,
    Buy(Dep, bool, bool),
    PayIncome(u128),
    Rotate(usize, bool),
    ResolveTransfer(bool),
    ExpirePending,
    Outcome(usize, bool),
    Advance(u64),
}

fn dep() -> impl Strategy<Value = Dep> {
    prop_oneof![6 => Just(Dep::Exact), 1 => Just(Dep::Zero), 1 => Just(Dep::One), 1 => Just(Dep::Less), 1 => Just(Dep::More)]
}

/// The account that would normally take this step now (so deep states are reached); 30% of steps
/// still use a random account, which exercises the permission checks.
fn natural_actor(p: &PieceCore, op: &Op, pick: usize) -> AccountId {
    let artist = p.artist.clone();
    let owner = p.owner.clone();
    let creditors: Vec<AccountId> = p.credits.iter().filter(|(_, s)| s.available > 0).map(|(a, _)| a.clone()).collect();
    match op {
        Op::Fund(..) => acc("client.near"),
        Op::Deliver | Op::ProposeSplit(_) if pick % 2 == 0 => artist,
        Op::Deliver => artist,
        Op::ProposeSplit(_) => owner,
        Op::AcceptSplit(_) => match &p.split { Some(s) if s.by == artist => owner, _ => artist },
        Op::RequestChanges | Op::Accept | Op::Reject(_) | Op::ClaimRefund | Op::Release(_) | Op::List(..) | Op::Delist | Op::Withdraw => owner,
        Op::Resolve(_) => if pick % 2 == 0 { acc("arb.near") } else { acc("fallback.near") },
        Op::Buy(..) => if pick % 2 == 0 { acc("buyer.near") } else { acc("buyer2.near") },
        Op::Rotate(..) | Op::ResolveTransfer(_) => acc("soulprint-v1.near"),
        Op::Claim | Op::ClaimTo(_) => creditors.get(pick % creditors.len().max(1)).cloned().unwrap_or(artist),
        Op::Cancel | Op::MutualCancel | Op::Extend(_) => if pick % 2 == 0 { artist } else { owner },
        _ => acc("stranger.near"),
    }
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        3 => (dep(), any::<bool>()).prop_map(|(d, b)| Op::Fund(d, b)),
        2 => Just(Op::Deliver),
        1 => Just(Op::RequestChanges),
        1 => (0u8..3).prop_map(Op::Release),
        2 => Just(Op::Accept),
        1 => Just(Op::Settle),
        1 => Just(Op::ClaimRefund),
        1 => Just(Op::Cancel).prop_filter("rare", |_| true),
        1 => Just(Op::MutualCancel),
        1 => (0u64..40).prop_map(|d| Op::Extend(d * DAY)),
        2 => dep().prop_map(Op::Reject),
        1 => (0u16..=10_000).prop_map(Op::ProposeSplit),
        1 => any::<bool>().prop_map(Op::AcceptSplit),
        1 => (0u16..=10_001).prop_map(Op::Resolve),
        1 => Just(Op::TimeoutResolve),
        2 => Just(Op::Claim),
        1 => (0usize..8).prop_map(Op::ClaimTo),
        1 => Just(Op::Withdraw),
        2 => ((0u128..400), any::<bool>()).prop_map(|(p, r)| Op::List(p, r)),
        1 => Just(Op::Delist),
        2 => (dep(), any::<bool>(), any::<bool>()).prop_map(|(d, s, p)| Op::Buy(d, s, p)),
        2 => (0u128..20).prop_map(Op::PayIncome),
        1 => (0usize..8, any::<bool>()).prop_map(|(t, c)| Op::Rotate(t, c)),
        1 => any::<bool>().prop_map(Op::ResolveTransfer),
        1 => Just(Op::ExpirePending),
        3 => (0usize..16, any::<bool>()).prop_map(|(i, ok)| Op::Outcome(i, ok)),
        3 => prop_oneof![Just(SEC), Just(DAY), Just(3 * DAY), Just(8 * DAY), Just(15 * DAY)].prop_map(Op::Advance),
    ]
}

struct World {
    p: PieceCore,
    ft: bool,
    now: u64,
    /// Currency the piece holds (tokens for FT pieces, NEAR for NEAR pieces; storage is the wrapper's concern).
    ledger: u128,
    /// Payouts dispatched but not yet resolved: (slot, amount).
    flight: Vec<(SlotId, u128)>,
}

impl World {
    fn amount(&self, d: Dep, exact: u128) -> u128 {
        match d {
            Dep::Zero => 0,
            Dep::One => 1,
            Dep::Exact => exact,
            Dep::Less => exact.saturating_sub(1),
            Dep::More => exact + 1,
        }
    }
    fn value_ctx(&self, who: &AccountId, amount: u128) -> Ctx {
        Ctx {
            predecessor: who.clone(),
            payer: who.clone(),
            token: if self.ft { Some(usdc()) } else { None },
            attached: amount,
            now: self.now,
            prepaid_gas: 300_000_000_000_000,
        }
    }
    fn ctx(&self, who: &AccountId, attached: u128) -> Ctx {
        Ctx { predecessor: who.clone(), payer: who.clone(), token: None, attached, now: self.now, prepaid_gas: 300_000_000_000_000 }
    }
    fn absorb(&mut self, fx: &Effects) -> Result<(), TestCaseError> {
        for e in fx {
            match e {
                Effect::TransferNear { amount, slot, .. } | Effect::TransferFt { amount, slot, .. } => {
                    prop_assert!(self.ledger >= *amount, "I1: paid out {} with only {} held", amount, self.ledger);
                    self.ledger -= *amount;
                    self.flight.push((slot.clone(), *amount));
                }
                _ => {}
            }
        }
        Ok(())
    }
}

const OWNER_OPS: &[&str] = &["accept", "request_changes", "release", "reject", "claim_refund", "list", "delist", "withdraw"];

fn step(w: &mut World, op: &Op, actor: &AccountId) -> Result<(), TestCaseError> {
    let before = borsh::to_vec(&w.p).unwrap();
    let pre_owner = w.p.owner.clone();
    let pre_seq = w.p.rotation_seq;
    let pre_pending = w.p.transfer_pending.is_some();
    let pre_slot = w.p.credits.get(&pre_owner).cloned().unwrap_or_default();
    let all = actors();
    let price = w.p.terms.as_ref().map(|t| t.price.0).unwrap_or(0);
    let mut value_in = 0u128;
    let mut kind = "";
    let r: Result<Effects, Error> = match op {
        Op::Fund(d, ok_hash) => {
            value_in = w.amount(*d, price);
            let h = if *ok_hash { w.p.terms_hash.unwrap_or(Bytes32([0; 32])) } else { Bytes32([9; 32]) };
            w.p.fund(&w.value_ctx(actor, value_in), h, None)
        }
        Op::Deliver => w.p.deliver(&w.ctx(actor, 1), Bytes32([1; 32]), Bytes32([2; 32])),
        Op::RequestChanges => {
            kind = "request_changes";
            w.p.request_changes(&w.ctx(actor, 1))
        }
        Op::Release(i) => {
            kind = "release";
            w.p.release_milestone(&w.ctx(actor, 1), *i)
        }
        Op::Accept => {
            kind = "accept";
            w.p.accept(&w.ctx(actor, 1))
        }
        Op::Settle => w.p.settle(&w.ctx(actor, 0)),
        Op::ClaimRefund => {
            kind = "claim_refund";
            w.p.claim_refund(&w.ctx(actor, 1))
        }
        Op::Cancel => w.p.cancel(&w.ctx(actor, 1)),
        Op::MutualCancel => w.p.consent_mutual_cancel(&w.ctx(actor, 1)),
        Op::Extend(d) => {
            let nd = w.p.deadline.saturating_add(*d);
            w.p.consent_extend(&w.ctx(actor, 1), nd)
        }
        Op::Reject(d) => {
            kind = "reject";
            let bond = w.p.terms.as_ref().map(|t| t.reject_bond()).unwrap_or(0);
            value_in = w.amount(*d, bond);
            w.p.reject(&w.value_ctx(actor, value_in))
        }
        Op::ProposeSplit(b) => w.p.propose_split(&w.ctx(actor, 1), *b),
        Op::AcceptSplit(right) => {
            let (b, n) = w.p.split.as_ref().map(|s| (s.artist_bps, s.nonce)).unwrap_or((0, 0));
            w.p.accept_split(&w.ctx(actor, 1), b, if *right { n } else { n + 1 })
        }
        Op::Resolve(b) => w.p.resolve(&w.ctx(actor, 1), *b),
        Op::TimeoutResolve => w.p.timeout_resolve(&w.ctx(actor, 0)),
        Op::Claim => w.p.claim(&w.ctx(actor, 0)),
        Op::ClaimTo(t) => w.p.claim_to(&w.ctx(actor, 1), all[*t].clone()),
        Op::Withdraw => {
            kind = "withdraw";
            w.p.withdraw(&w.ctx(actor, 1))
        }
        Op::List(p, reserved) => {
            kind = "list";
            let price = p * unit(w.ft);
            w.p.list(&w.ctx(actor, 1), price, if *reserved { Some(acc("buyer.near")) } else { None })
        }
        Op::Delist => {
            kind = "delist";
            w.p.delist(&w.ctx(actor, 1))
        }
        Op::Buy(d, stale, pool_ok) => {
            let (lp, ln) = w.p.listing.as_ref().map(|l| (l.price, l.nonce)).unwrap_or((0, 0));
            value_in = w.amount(*d, lp);
            let pool = if *pool_ok { w.p.holder_pool } else { w.p.holder_pool + 1 };
            w.p.buy(&w.value_ctx(actor, value_in), if *stale { ln + 1 } else { ln }, lp, pool)
        }
        Op::PayIncome(n) => {
            value_in = *n * unit(w.ft) / 10;
            w.p.pay_income(&w.value_ctx(actor, value_in))
        }
        Op::Rotate(t, call) => {
            let owner = w.p.owner.clone();
            w.p.rotate_owner(&w.ctx(actor, 0), owner, all[*t].clone(), *call)
        }
        Op::ResolveTransfer(revert) => w.p.resolve_transfer(&w.ctx(actor, 0), *revert),
        Op::ExpirePending => w.p.expire_pending(&w.ctx(actor, 0)),
        Op::Outcome(i, ok) => {
            if w.flight.is_empty() {
                return Ok(());
            }
            let idx = i % w.flight.len();
            let (slot, amount) = w.flight.remove(idx);
            if !ok {
                w.ledger += amount; // the failed transfer's refund comes back
            }
            let fx = w.p.on_transfer_result(slot, amount, *ok);
            w.absorb(&fx)?;
            return check(w);
        }
        Op::Advance(d) => {
            w.now += d;
            return check(w);
        }
    };
    match r {
        Ok(fx) => {
            count(format!("{op:?}").split('(').next().unwrap());
            count(&format!("status:{:?}", w.p.status));
            w.ledger += value_in;
            w.absorb(&fx)?;
            // I6: owner actions only by the owner, never while a transfer is pending.
            if OWNER_OPS.contains(&kind) {
                prop_assert_eq!(actor, &pre_owner, "I6: {} by a non-owner", kind);
                prop_assert!(!pre_pending, "I6: {} while a transfer is pending", kind);
            }
            // I5: a sale credits the seller exactly price − royalty; their in-flight claims stay.
            if let Op::Buy(..) = op {
                let s = w.p.credits.get(&pre_owner).cloned().unwrap_or_default();
                let royalty = value_in * w.p.royalty_bps as u128 / 10_000;
                // An artist who owns the piece again receives the royalty as well.
                let expected = pre_slot.available + value_in - if pre_owner == w.p.artist { 0 } else { royalty };
                prop_assert_eq!(s.available, expected, "I5 seller credit");
                prop_assert_eq!(s.in_flight, pre_slot.in_flight, "I5 seller in-flight");
            }
            // I3: rotation_seq never goes backwards; a change of owner moves it forward.
            prop_assert!(w.p.rotation_seq >= pre_seq, "I3 seq went back");
            if w.p.owner != pre_owner {
                prop_assert!(w.p.rotation_seq > pre_seq, "I3 owner changed without a new seq");
            }
        }
        Err(_) => {
            // I4: a rejected step changes nothing (the value is returned).
            prop_assert!(borsh::to_vec(&w.p).unwrap() == before, "I4: rejected {:?} changed state", op);
        }
    }
    check(w)
}

fn check(w: &World) -> Result<(), TestCaseError> {
    let p = &w.p;
    // I1: what the piece holds covers everything it owes.
    prop_assert!(w.ledger >= p.liabilities(), "I1: ledger {} < liabilities {}", w.ledger, p.liabilities());
    let flying: u128 = p.credits.values().map(|s| s.in_flight).sum();
    let queued: u128 = w.flight.iter().map(|(_, a)| *a).sum();
    prop_assert_eq!(flying, queued, "I1: in-flight bookkeeping");
    // I2: released + refunded + escrow == funded.
    prop_assert_eq!(p.released + p.refunded + p.escrow, p.funded, "I2");
    // I3: the artist owns an offered or cancelled commission.
    if matches!(p.status, Status::Offered | Status::Cancelled) && p.mode == Mode::Commission {
        prop_assert_eq!(&p.owner, &p.artist, "I3 owner in {:?}", p.status);
    }
    Ok(())
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: std::env::var("PROPTEST_CASES").ok().and_then(|v| v.parse().ok()).unwrap_or(2_000),
        max_shrink_iters: 20_000,
        ..ProptestConfig::default()
    })]
    #[test]
    fn invariants_hold(ft in any::<bool>(), named in any::<bool>(), ops in prop::collection::vec((op(), 0usize..20), 1..200)) {
        let cur = currency(ft);
        let p = PieceCore::new(
            acc("p1.soulprint-v1.near"), acc("soulprint-v1.near"), acc("artist.near"),
            PieceKind::Commission(terms(&cur, ft, named)), Bytes32([42; 32]), TimeConfig::production(), cur, T0,
        ).unwrap();
        let mut w = World { p, ft, now: T0 + SEC, ledger: 0, flight: vec![] };
        let all = actors();
        for (o, a) in &ops {
            // Cancel by the artist ends most sequences early: let it through only rarely.
            if matches!(o, Op::Cancel) && a % 4 != 0 { continue; }
            let actor = if *a < 14 { natural_actor(&w.p, o, *a) } else { all[*a % all.len()].clone() };
            step(&mut w, o, &actor)?;
        }
    }
}

#[test]
fn zz_print_stats() {
    if std::env::var("MODEL_STATS").is_ok() {
        let mut s = STATS.lock().unwrap().clone();
        s.sort();
        println!("{s:?}");
    }
}
