//! near-sdk unit tests for the wrapper: env → Ctx, payments in, gates, callbacks.
use crate::contract::*;
use common::*;
use near_sdk::json_types::{U128, U64};
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, AccountId, Gas, NearToken, PromiseResult, PublicKey};
use std::panic::{catch_unwind, AssertUnwindSafe};

const T0: u64 = 1_800_000_000_000_000_000;
const DAY: u64 = 86_400_000_000_000;
const PRICE: u128 = 100_000_000;

fn acc(s: &str) -> AccountId { s.parse().unwrap() }
fn piece_id() -> AccountId { acc("p1.soulprint-v1.near") }
fn collection() -> AccountId { acc("soulprint-v1.near") }
fn artist() -> AccountId { acc("artist.near") }
fn client() -> AccountId { acc("client.near") }
fn usdc() -> AccountId { acc("usdc.near") }

fn set(pred: &AccountId, deposit: u128, now: u64, balance_near: u128, results: Vec<PromiseResult>) {
    let ctx = VMContextBuilder::new()
        .current_account_id(piece_id())
        .predecessor_account_id(pred.clone())
        .signer_account_id(pred.clone())
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_yoctonear(balance_near))
        .block_timestamp(now)
        .prepaid_gas(Gas::from_tgas(300))
        .build();
    testing_env!(ctx, near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), results);
}
fn call(pred: &AccountId, deposit: u128, now: u64) {
    set(pred, deposit, now, 10u128.pow(25), vec![]);
}

fn cur(c: Currency) -> CurrencyConfig {
    let near = c == Currency::Near;
    CurrencyConfig {
        currency: c,
        decimals: if near { 24 } else { 6 },
        min_price: U128(if near { 10u128.pow(23) } else { 1_000_000 }),
        min_list: U128(100_000),
        min_income: U128(10_000),
        badge_min: U128(20_000_000),
    }
}

fn terms(c: &CurrencyConfig, price: u128) -> Terms {
    Terms {
        price: U128(price),
        currency: c.currency.clone(),
        milestones: vec![Milestone { bps: 10_000 }],
        deadline_ns: U64(T0 + 30 * DAY),
        grace_ns: U64(2 * DAY),
        review_window_ns: U64(7 * DAY),
        revision_period_ns: U64(3 * DAY),
        revision_rounds: 2,
        arbitrator: acc("arb.near"),
        fallback_arbitrator: acc("fallback.near"),
        timeout_artist_bps: DEFAULT_TIMEOUT_ARTIST_BPS,
        reject_bond_bps: DEFAULT_REJECT_BOND_BPS,
        royalty_bps: DEFAULT_ROYALTY_BPS,
        grant: Grant { kind: GrantType::CommercialNonExclusive, attribution: true, transferable: true },
        licence_text_hash: Bytes32([7; 32]),
        client: Some(client()),
    }
}

fn capture_pk() -> PublicKey {
    ed25519_pk(&Bytes32(ed25519_dalek::SigningKey::from_bytes(&[42u8; 32]).verifying_key().to_bytes()))
}

fn ft_piece() -> Piece {
    call(&collection(), 0, T0);
    let c = cur(Currency::Ft(usdc()));
    Piece::init(PieceKind::Commission(terms(&c, PRICE)), artist(), capture_pk(), TimeConfig::production(), c)
}

fn near_piece() -> Piece {
    call(&collection(), 0, T0);
    let c = cur(Currency::Near);
    Piece::init(PieceKind::Commission(terms(&c, 10u128.pow(24))), artist(), capture_pk(), TimeConfig::production(), c)
}

fn panics<R>(f: impl FnOnce() -> R) -> String {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(_) => "no panic".into(),
        Err(e) => e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default(),
    }
}

fn fund_msg(p: &Piece) -> String {
    let h = p.piece_info().terms_hash.unwrap();
    near_sdk::serde_json::json!({ "action": "fund", "expected_terms_hash": h }).to_string()
}

#[test]
fn init_only_once_only_collection() {
    call(&acc("stranger.near"), 0, T0);
    let c = cur(Currency::Near);
    let msg = panics(|| Piece::init(PieceKind::Commission(terms(&c, 10u128.pow(24))), artist(), capture_pk(), TimeConfig::production(), c.clone()));
    assert!(msg.contains("ERR_NOT_PARENT"), "{msg}");
    let p = near_piece();
    assert_eq!(p.piece_info().owner, artist());
}

#[test]
fn ft_on_transfer_rejects_wrong_predecessor() {
    let mut p = ft_piece();
    let before = near_sdk::borsh::to_vec(&p).unwrap();
    call(&acc("evil.near"), 0, T0 + 1);
    let msg = fund_msg(&p);
    let back = p.ft_on_transfer(client(), U128(PRICE), msg);
    assert!(back == U128(PRICE));
    assert_eq!(near_sdk::borsh::to_vec(&p).unwrap(), before);
}

#[test]
fn ft_fund_via_ft_on_transfer() {
    let mut p = ft_piece();
    call(&usdc(), 0, T0 + 1);
    let msg = fund_msg(&p);
    let back = p.ft_on_transfer(client(), U128(PRICE), msg);
    assert!(back == U128(0));
    let i = p.piece_info();
    assert_eq!(i.owner, client());
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"funded\"")));
}

#[test]
fn ft_action_error_returns_full_amount() {
    let mut p = ft_piece();
    call(&usdc(), 0, T0 + 1);
    let msg = fund_msg(&p);
    let back = p.ft_on_transfer(client(), U128(PRICE - 1), msg);
    assert_eq!(back, U128(PRICE - 1));
    assert_eq!(p.piece_info().owner, artist());
    let back = p.ft_on_transfer(client(), U128(5), "not json".into());
    assert!(back == U128(5));
}

#[test]
fn near_payable_rejected_on_ft_piece() {
    let mut p = ft_piece();
    let h = p.piece_info().terms_hash.unwrap();
    call(&client(), PRICE, T0 + 1);
    let msg = panics(|| p.fund(h, None));
    assert!(msg.contains("ERR_WRONG_CURRENCY"), "{msg}");
}

#[test]
fn ft_rejected_on_near_piece() {
    let mut p = near_piece();
    call(&usdc(), 0, T0 + 1);
    let msg = fund_msg(&p);
    let back = p.ft_on_transfer(client(), U128(10u128.pow(24)), msg);
    assert_eq!(back, U128(10u128.pow(24)));
}

#[test]
fn near_fund_by_deposit() {
    let mut p = near_piece();
    let h = p.piece_info().terms_hash.unwrap();
    call(&client(), 10u128.pow(24), T0 + 1);
    p.fund(h, None);
    assert_eq!(p.piece_info().owner, client());
    assert_eq!(p.accounting().escrow, U128(10u128.pow(24)));
}

#[test]
fn every_gated_method_requires_one_yocto() {
    let h32 = Bytes32([1; 32]);
    type Call = Box<dyn Fn(&mut Piece)>;
    let table: Vec<(&str, Call)> = vec![
        ("deliver", Box::new(move |p| p.deliver(h32, h32))),
        ("request_changes", Box::new(|p| p.request_changes())),
        ("release_milestone", Box::new(|p| p.release_milestone(0))),
        ("accept", Box::new(|p| p.accept())),
        ("claim_refund", Box::new(|p| p.claim_refund())),
        ("cancel", Box::new(|p| p.cancel())),
        ("consent_mutual_cancel", Box::new(|p| p.consent_mutual_cancel())),
        ("consent_extend", Box::new(|p| p.consent_extend(U64(T0 + 40 * DAY)))),
        ("propose_split", Box::new(|p| p.propose_split(5000))),
        ("accept_split", Box::new(|p| p.accept_split(5000, 1))),
        ("resolve", Box::new(|p| p.resolve(5000))),
        ("withdraw", Box::new(|p| p.withdraw())),
        ("claim_to", Box::new(|p| p.claim_to(acc("x.near")))),
        ("list", Box::new(|p| p.list(U128(1_000_000), None))),
        ("delist", Box::new(|p| p.delist())),
        ("add_capture_key", Box::new(|p| p.add_capture_key(ed25519_pk(&Bytes32([3; 32]))))),
        ("invite_challenger", Box::new(|p| p.invite_challenger(acc("judge.near")))),
        ("issue_challenge", Box::new(move |p| p.issue_challenge(h32))),
        ("propose_addendum", Box::new(move |p| p.propose_addendum(Grant { kind: GrantType::FullAssignment, attribution: true, transferable: true }, h32))),
        ("accept_addendum", Box::new(move |p| p.accept_addendum(h32))),
        ("settle_standalone", Box::new(move |p| p.settle_standalone(h32, h32))),
        ("reopen_as_standalone", Box::new(|p| p.reopen_as_standalone())),
    ];
    for (name, f) in table {
        for who in [artist(), client(), acc("arb.near")] {
            let mut p = near_piece();
            call(&who, 0, T0 + 1);
            let msg = panics(|| f(&mut p));
            assert!(msg.contains("ERR_REQUIRES_DEPOSIT"), "{name} by {who}: {msg}");
        }
    }
}

#[test]
fn restore_callback_never_checks_balance() {
    let mut p = near_piece();
    let h = p.piece_info().terms_hash.unwrap();
    call(&client(), 10u128.pow(24), T0 + 1);
    p.fund(h, None);
    call(&artist(), 1, T0 + 2);
    p.deliver(Bytes32([1; 32]), Bytes32([1; 32]));
    call(&client(), 1, T0 + 3);
    p.accept();
    call(&artist(), 0, T0 + 4);
    p.claim();
    // Refund of the failed transfer has not landed yet: balance is far below liabilities.
    set(&piece_id(), 0, T0 + 5, 1, vec![PromiseResult::Failed]);
    p.on_transfer_result(crate::core::SlotId::Credit(artist()), U128(10u128.pow(24)));
    let a = p.accounting();
    let c = a.credits.iter().find(|c| c.account == artist()).unwrap();
    assert_eq!((c.available, c.in_flight), (U128(10u128.pow(24)), U128(0)));
}

#[test]
fn storage_check_rejects_unfunded_growth() {
    let mut p = near_piece();
    // Balance covers nothing: any mutating call must fail the live storage check.
    set(&artist(), 1, T0 + 1, 1, vec![]);
    let msg = panics(|| p.invite_challenger(acc("judge.near")));
    assert!(msg.contains("ERR_STORAGE"), "{msg}");
}

#[test]
fn views_serialise_with_strings() {
    let p = ft_piece();
    let v = near_sdk::serde_json::to_value(p.piece_info()).unwrap();
    assert_eq!(v["rotation_seq"], "0");
    assert_eq!(v["token_id"], "1");
    assert!(v["licence_text_hash"].is_string());
    let pr = near_sdk::serde_json::to_value(p.proof_page(0, 10)).unwrap();
    assert!(pr["segments"][0]["key"].as_str().unwrap().starts_with("ed25519:"));
    let a = near_sdk::serde_json::to_value(p.accounting()).unwrap();
    assert_eq!(a["escrow"], "0");
}

#[test]
fn view_fixtures_written() {
    // A settled, listed FT piece with income and one claim in flight: every view populated.
    let mut p = ft_piece();
    call(&usdc(), 0, T0 + 1);
    let msg = fund_msg(&p);
    assert_eq!(p.ft_on_transfer(client(), U128(PRICE), msg), U128(0));
    call(&artist(), 1, T0 + 2);
    p.deliver(Bytes32([1; 32]), Bytes32([2; 32]));
    call(&client(), 1, T0 + 3);
    p.accept();
    call(&usdc(), 0, T0 + 4);
    p.ft_on_transfer(acc("shop.near"), U128(50_000), r#"{"action":"pay_income"}"#.into());
    call(&artist(), 0, T0 + 5);
    p.claim();
    call(&client(), 1, T0 + 6);
    p.list(U128(500_000_000), None);
    let v = near_sdk::serde_json::json!({
        "piece_info": p.piece_info(),
        "terms": p.terms(),
        "accounting": p.accounting(),
        "proof_page": p.proof_page(0, 32),
        "listing": p.listing(),
        "owner_info": p.owner_info(),
        "nft_item_info": p.nft_item_info(),
        "time_config": p.time_config(),
    });
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../abi");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("piece-views.json"), near_sdk::serde_json::to_string_pretty(&v).unwrap() + "\n").unwrap();
    assert_eq!(v["piece_info"]["status"], "Settled");
    assert_eq!(v["accounting"]["holder_pool"], "50000");
    assert_eq!(v["listing"]["nonce"], "1");
}
