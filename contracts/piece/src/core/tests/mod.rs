//! Unit tests for the pure core. `Fx` builds a piece and drives it with explicit contexts.
#![allow(dead_code)]
pub use crate::core::*;
pub use common::*;
use near_sdk::AccountId;

mod t3_skeleton;
mod t4_status;
mod t5_commission;
mod t6_dispute;

pub const SEC: u64 = 1_000_000_000;
pub const DAY: u64 = 86_400 * SEC;
pub const T0: u64 = 1_800_000_000_000_000_000;
pub const PRICE: u128 = 100_000_000; // 100 USDC (6 decimals)

pub fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
pub fn artist() -> AccountId { acc("artist.near") }
pub fn client() -> AccountId { acc("client.near") }
pub fn arb() -> AccountId { acc("arb.near") }
pub fn fallback() -> AccountId { acc("fallback.near") }
pub fn buyer() -> AccountId { acc("buyer.near") }
pub fn buyer2() -> AccountId { acc("buyer2.near") }
pub fn stranger() -> AccountId { acc("stranger.near") }
pub fn usdc() -> AccountId { acc("usdc.near") }
pub fn collection() -> AccountId { acc("soulprint-v1.near") }
pub fn piece_id() -> AccountId { acc("p1.soulprint-v1.near") }

pub fn cur_ft() -> CurrencyConfig {
    CurrencyConfig {
        currency: Currency::Ft(usdc()),
        decimals: 6,
        min_price: 1_000_000u128.into(),
        min_list: 100_000u128.into(),
        min_income: 10_000u128.into(),
        badge_min: 20_000_000u128.into(),
    }
}
pub fn cur_near() -> CurrencyConfig {
    CurrencyConfig {
        currency: Currency::Near,
        decimals: 24,
        min_price: 10u128.pow(23).into(),
        min_list: 10u128.pow(23).into(),
        min_income: 10u128.pow(21).into(),
        badge_min: 10u128.pow(24).into(),
    }
}

/// 100 USDC on FT pieces, 10 NEAR on NEAR pieces.
pub fn price_for(cur: &CurrencyConfig) -> u128 {
    match cur.currency {
        Currency::Near => 10u128.pow(25),
        Currency::Ft(_) => PRICE,
    }
}

pub fn terms(cur: &CurrencyConfig) -> Terms {
    Terms {
        price: price_for(cur).into(),
        currency: cur.currency.clone(),
        milestones: vec![Milestone { bps: 3000 }, Milestone { bps: 7000 }],
        deadline_ns: (T0 + 30 * DAY).into(),
        grace_ns: (2 * DAY).into(),
        review_window_ns: (7 * DAY).into(),
        revision_period_ns: (3 * DAY).into(),
        revision_rounds: 2,
        arbitrator: arb(),
        fallback_arbitrator: fallback(),
        timeout_artist_bps: DEFAULT_TIMEOUT_ARTIST_BPS,
        reject_bond_bps: DEFAULT_REJECT_BOND_BPS,
        royalty_bps: DEFAULT_ROYALTY_BPS,
        grant: Grant { kind: GrantType::CommercialNonExclusive, attribution: true, transferable: true },
        licence_text_hash: Bytes32([7; 32]),
        client: Some(client()),
    }
}

pub fn capture_sk() -> ed25519_dalek::SigningKey {
    ed25519_dalek::SigningKey::from_bytes(&[42u8; 32])
}
pub fn capture_pk() -> Bytes32 {
    Bytes32(capture_sk().verifying_key().to_bytes())
}

/// Real ed25519 verification for tests (the contract uses env::ed25519_verify).
pub struct Dalek;
impl Verifier for Dalek {
    fn ed25519(&self, sig: &Bytes64, msg: &[u8], pk: &Bytes32) -> bool {
        let Ok(vk) = ed25519_dalek::VerifyingKey::from_bytes(&pk.0) else { return false };
        vk.verify_strict(msg, &ed25519_dalek::Signature::from_bytes(&sig.0)).is_ok()
    }
}

/// NEAR call context.
pub fn cx(who: &AccountId, attached: u128, now: u64) -> Ctx {
    Ctx { predecessor: who.clone(), payer: who.clone(), token: None, attached, now, prepaid_gas: 300_000_000_000_000 }
}
/// FT action context (ft_on_transfer): predecessor = sender_id (A14).
pub fn fx_ft(who: &AccountId, amount: u128, now: u64) -> Ctx {
    Ctx { predecessor: who.clone(), payer: who.clone(), token: Some(usdc()), attached: amount, now, prepaid_gas: 300_000_000_000_000 }
}

pub fn new_piece(cur: &CurrencyConfig) -> PieceCore {
    PieceCore::new(
        piece_id(), collection(), artist(), PieceKind::Commission(terms(cur)), capture_pk(),
        TimeConfig::production(), cur.clone(), T0,
    )
    .unwrap()
}

pub fn has_event(fx: &Effects, name: &str) -> bool {
    fx.iter().any(|e| matches!(e, Effect::Event(ev) if ev.name() == name))
}

pub const FUND_AT: u64 = T0 + SEC;

pub fn fund_ctx(cur: &CurrencyConfig, who: &AccountId, amount: u128, now: u64) -> Ctx {
    match cur.currency {
        Currency::Near => cx(who, amount, now),
        Currency::Ft(_) => fx_ft(who, amount, now),
    }
}

/// Funded by the named client at FUND_AT.
pub fn funded(cur: &CurrencyConfig) -> PieceCore {
    let mut p = new_piece(cur);
    let h = p.terms_hash.unwrap();
    p.fund(&fund_ctx(cur, &client(), price_for(cur), FUND_AT), h, None).unwrap();
    p
}

pub const DELIVER_AT: u64 = T0 + 10 * DAY;

pub fn delivered_piece(cur: &CurrencyConfig) -> PieceCore {
    let mut p = funded(cur);
    p.deliver(&cx(&artist(), 1, DELIVER_AT), Bytes32([0xf1; 32]), Bytes32([0xe1; 32])).unwrap();
    p
}

pub fn settled_piece(cur: &CurrencyConfig) -> PieceCore {
    let mut p = delivered_piece(cur);
    p.accept(&cx(&client(), 1, DELIVER_AT + DAY)).unwrap();
    p
}

pub const SETTLED_AT: u64 = DELIVER_AT + DAY;

pub const BOND: u128 = PRICE * 500 / 10_000;
pub const REJECT_AT: u64 = DELIVER_AT + DAY;

pub fn disputed_piece() -> PieceCore {
    let mut p = delivered_piece(&cur_ft());
    p.reject(&fx_ft(&client(), BOND, REJECT_AT)).unwrap();
    p
}
