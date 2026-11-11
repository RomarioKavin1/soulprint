use crate::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, Gas, PromiseResult};
use std::panic::{catch_unwind, AssertUnwindSafe};

const T0: u64 = 1_800_000_000_000_000_000;
const DAY: u64 = 86_400_000_000_000;

fn acc(s: &str) -> AccountId { s.parse().unwrap() }
fn me() -> AccountId { acc("soulprint-v1.near") }
fn gov() -> AccountId { acc("gov.near") }
fn artist() -> AccountId { acc("artist.near") }
fn usdc() -> AccountId { acc("usdc.near") }
fn p(n: &str) -> AccountId { piece_account(n, &me()) }

fn set(pred: &AccountId, deposit: u128, now: u64, results: Vec<PromiseResult>) {
    let ctx = VMContextBuilder::new()
        .current_account_id(me())
        .predecessor_account_id(pred.clone())
        .signer_account_id(pred.clone())
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_near(100))
        .block_timestamp(now)
        .prepaid_gas(Gas::from_tgas(300))
        .build();
    testing_env!(ctx, near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), results);
}
fn call(pred: &AccountId, deposit: u128, now: u64) { set(pred, deposit, now, vec![]) }

fn panics<R>(f: impl FnOnce() -> R) -> String {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(_) => "no panic".into(),
        Err(e) => e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default(),
    }
}

fn sk(n: u8) -> ed25519_dalek::SigningKey { ed25519_dalek::SigningKey::from_bytes(&[n; 32]) }
fn pk(n: u8) -> PublicKey { ed25519_pk(&Bytes32(sk(n).verifying_key().to_bytes())) }

fn currencies() -> Vec<CurrencyConfig> {
    vec![
        CurrencyConfig { currency: Currency::Near, decimals: 24, min_price: U128(10u128.pow(23)), min_list: U128(10u128.pow(23)), min_income: U128(10u128.pow(21)), badge_min: U128(10u128.pow(24)) },
        CurrencyConfig { currency: Currency::Ft(usdc()), decimals: 6, min_price: U128(1_000_000), min_list: U128(100_000), min_income: U128(10_000), badge_min: U128(20_000_000) },
    ]
}

fn coll() -> Collection {
    call(&acc("near"), 0, T0);
    Collection::new(gov(), currencies(), "testnet".into(), TimeConfig::production(), vec![pk(1)])
}

fn standalone_kind(c: Currency) -> PieceKind {
    PieceKind::Standalone(StandaloneTerms {
        currency: c, royalty_bps: 500,
        grant: Grant { kind: GrantType::CommercialNonExclusive, attribution: true, transferable: true },
        licence_text_hash: Bytes32([0; 32]),
    })
}

fn created() -> Created {
    Created { mode: "standalone".into(), currency: Currency::Near, terms_hash: None, ft_registration: U128(0) }
}

/// Create token N and run its success callback.
fn minted(c: &mut Collection, n: &str) {
    let cost = c.piece_creation_cost(Currency::Near).0;
    call(&artist(), cost, T0);
    let _ = c.create_piece(standalone_kind(Currency::Near), pk(9));
    set(&me(), 0, T0, vec![PromiseResult::Successful(vec![])]);
    c.on_piece_created(n.into(), artist(), artist(), U128(cost), created());
}

#[test]
fn create_piece_indexes_on_success() {
    let mut c = coll();
    minted(&mut c, "1");
    let t = c.nft_token("1".into()).unwrap();
    assert_eq!(t.owner_id, artist());
    assert_eq!(c.nft_total_supply(), U128(1));
    assert_eq!(c.nft_supply_for_owner(artist()), U128(1));
    assert!(get_logs().iter().any(|l| l.contains("\"standard\":\"nep171\"") && l.contains("nft_mint")));
    assert!(get_logs().iter().any(|l| l.contains("piece_created")));
}

#[test]
fn create_piece_requires_cost_and_known_currency() {
    let mut c = coll();
    let cost = c.piece_creation_cost(Currency::Near).0;
    call(&artist(), cost - 1, T0);
    assert!(panics(|| c.create_piece(standalone_kind(Currency::Near), pk(9))).contains("ERR_DEPOSIT"));
    call(&artist(), cost * 2, T0);
    assert!(panics(|| c.create_piece(standalone_kind(Currency::Ft(acc("dai.near"))), pk(9))).contains("ERR_CURRENCY"));
    assert!(c.piece_creation_cost(Currency::Ft(usdc())).0 > cost, "FT pieces also pay the token registration");
}

#[test]
fn create_piece_validates_terms_early() {
    let mut c = coll();
    let mut kind = standalone_kind(Currency::Near);
    if let PieceKind::Standalone(s) = &mut kind { s.royalty_bps = 5000; }
    call(&artist(), 10u128.pow(24), T0);
    assert!(panics(|| c.create_piece(kind, pk(9))).contains("ERR_TERMS"));
}

#[test]
fn create_piece_burns_id_on_failure() {
    let mut c = coll();
    let cost = c.piece_creation_cost(Currency::Near).0;
    call(&artist(), cost, T0);
    let _ = c.create_piece(standalone_kind(Currency::Near), pk(9));
    set(&me(), 0, T0, vec![PromiseResult::Failed]);
    c.on_piece_created("1".into(), artist(), artist(), U128(cost), created());
    assert!(c.nft_token("1".into()).is_none());
    assert_eq!(c.collection_info().next_token_id, U64(2));
    call(&artist(), cost, T0);
    let _ = c.create_piece(standalone_kind(Currency::Near), pk(9));
    assert_eq!(c.collection_info().next_token_id, U64(3), "id 1 is never reused");
}

#[test]
fn collection_callbacks_are_private() {
    let mut c = coll();
    call(&artist(), 0, T0);
    assert!(panics(|| c.on_piece_created("1".into(), artist(), artist(), U128(1), created())).contains("private"));
    assert!(panics(|| c.on_rotate_resolved("1".into())).contains("private"));
    assert!(panics(|| c.nft_resolve_transfer(artist(), acc("b.near"), "1".into(), None)).contains("private"));
    assert!(panics(|| c.on_sync("1".into())).contains("private"));
    assert!(panics(|| c.on_resolved("1".into())).contains("private"));
}

#[test]
fn on_rotated_rejects_non_piece_predecessor() {
    let mut c = coll();
    minted(&mut c, "1");
    for who in [acc("stranger.near"), p("2"), gov(), me()] {
        call(&who, 0, T0);
        let m = panics(|| c.on_rotated("1".into(), acc("x.near"), U64(1)));
        assert!(m.contains("ERR_NOT_PIECE"), "{who}: {m}");
    }
    call(&p("1"), 0, T0);
    assert!(panics(|| c.on_rotated("9".into(), acc("x.near"), U64(1))).contains("ERR_NOT_PIECE"), "unknown token");
}

#[test]
fn on_rotated_ignores_stale_seq() {
    let mut c = coll();
    minted(&mut c, "1");
    call(&p("1"), 0, T0);
    c.on_rotated("1".into(), acc("client.near"), U64(1));
    assert_eq!(c.nft_token("1".into()).unwrap().owner_id, acc("client.near"));
    assert!(get_logs().iter().any(|l| l.contains("nft_transfer") && l.contains("client.near")));
    c.on_rotated("1".into(), acc("old.near"), U64(1));
    c.on_rotated("1".into(), acc("older.near"), U64(0));
    assert_eq!(c.nft_token("1".into()).unwrap().owner_id, acc("client.near"));
    assert_eq!(c.nft_supply_for_owner(artist()), U128(0));
    assert_eq!(c.nft_supply_for_owner(acc("client.near")), U128(1));
    assert_eq!(c.nft_tokens_for_owner(acc("client.near"), None, None).len(), 1);
}

#[test]
fn governance_cannot_call_rotate() {
    let mut c = coll();
    minted(&mut c, "1");
    call(&gov(), 1, T0);
    assert!(panics(|| c.on_rotated("1".into(), gov(), U64(5))).contains("ERR_NOT_PIECE"));
}

#[test]
fn on_rotate_resolved_panics_when_piece_refused() {
    let mut c = coll();
    minted(&mut c, "1");
    set(&me(), 0, T0, vec![PromiseResult::Failed]);
    assert!(panics(|| c.on_rotate_resolved("1".into())).contains("ERR_PIECE_REFUSED"));
    let ok = near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({
        "token_id": "1", "owner": "b.near", "seq": "1", "status": "Settled", "transfer_pending": false
    })).unwrap();
    set(&me(), 0, T0, vec![PromiseResult::Successful(ok)]);
    c.on_rotate_resolved("1".into());
    assert_eq!(c.nft_token("1".into()).unwrap().owner_id, acc("b.near"));
}

#[test]
fn nft_resolve_transfer_bounded_read() {
    let mut c = coll();
    minted(&mut c, "1");
    // (receiver result, expected return = "token stayed with receiver")
    for (res, kept) in [
        (PromiseResult::Successful(b"false".to_vec()), true),
        (PromiseResult::Successful(b"true".to_vec()), false),
        (PromiseResult::Successful(vec![b' '; 4 * 1024 * 1024]), false),
        (PromiseResult::Successful(b"garbage".to_vec()), false),
        (PromiseResult::Failed, false),
    ] {
        set(&me(), 0, T0, vec![res]);
        assert_eq!(c.nft_resolve_transfer(artist(), acc("b.near"), "1".into(), None), kept);
    }
}

#[test]
fn nft_transfer_requires_one_yocto() {
    let mut c = coll();
    minted(&mut c, "1");
    call(&artist(), 0, T0);
    assert!(panics(|| c.nft_transfer(acc("b.near"), "1".into(), None, None)).contains("yoctoNEAR"));
}

fn report(token: &str, network: &str) -> ReportMessage {
    ReportMessage::new(network.into(), p(token), Bytes32([1; 32]), Bytes32([2; 32]), 3, Bytes32([4; 32]), 2, Bytes32([5; 32]), 7, Bytes32([6; 32]))
}
fn sig(k: u8, m: &ReportMessage) -> Bytes64 {
    use ed25519_dalek::Signer;
    Bytes64(sk(k).sign(&m.signing_bytes()).to_bytes())
}

#[test]
fn attest_accepts_valid_signature() {
    let mut c = coll();
    minted(&mut c, "1");
    let m = report("1", "testnet");
    call(&acc("svc.near"), 0, T0);
    let _ = c.attest("1".into(), m.clone(), sig(1, &m), 1);
}

#[test]
fn attest_rejects_bad_signature() {
    let mut c = coll();
    minted(&mut c, "1");
    let m = report("1", "testnet");
    call(&acc("svc.near"), 0, T0);
    assert!(panics(|| c.attest("1".into(), m.clone(), sig(2, &m), 1)).contains("ERR_BAD_SIGNATURE"));
}

#[test]
fn attest_rejects_wrong_piece_or_network() {
    let mut c = coll();
    minted(&mut c, "1");
    minted(&mut c, "2");
    call(&acc("svc.near"), 0, T0);
    let m = report("2", "testnet");
    assert!(panics(|| c.attest("1".into(), m.clone(), sig(1, &m), 1)).contains("ERR_WRONG_PIECE"));
    let m = report("1", "mainnet");
    assert!(panics(|| c.attest("1".into(), m.clone(), sig(1, &m), 1)).contains("ERR_WRONG_NETWORK"));
    let mut m = report("1", "testnet");
    m.domain = "other".into();
    assert!(panics(|| c.attest("1".into(), m.clone(), sig(1, &m), 1)).contains("ERR_WRONG_DOMAIN"));
    let m = report("9", "testnet");
    assert!(panics(|| c.attest("9".into(), m.clone(), sig(1, &m), 1)).contains("ERR_NO_TOKEN"));
}

#[test]
fn attest_rejects_revoked_key() {
    let mut c = coll();
    minted(&mut c, "1");
    call(&gov(), 1, T0);
    c.revoke_key(1);
    let m = report("1", "testnet");
    call(&acc("svc.near"), 0, T0);
    assert!(panics(|| c.attest("1".into(), m.clone(), sig(1, &m), 1)).contains("ERR_KEY_INACTIVE"));
}

#[test]
fn pending_key_not_yet_valid() {
    let mut c = coll();
    minted(&mut c, "1");
    call(&gov(), 1, T0);
    c.propose_key(pk(2));
    let m = report("1", "testnet");
    call(&acc("svc.near"), 0, T0 + 3 * DAY - 1);
    assert!(panics(|| c.attest("1".into(), m.clone(), sig(2, &m), 2)).contains("ERR_KEY_INACTIVE"));
    call(&acc("svc.near"), 0, T0 + 3 * DAY);
    let _ = c.attest("1".into(), m.clone(), sig(2, &m), 2);
    c.activate_key(2);
    assert!(get_logs().iter().any(|l| l.contains("key_activated")));
}

#[test]
fn governance_only_and_one_yocto() {
    let mut c = coll();
    call(&artist(), 1, T0);
    assert!(panics(|| c.propose_key(pk(2))).contains("ERR_NOT_GOVERNANCE"));
    call(&gov(), 0, T0);
    assert!(panics(|| c.propose_key(pk(2))).contains("yoctoNEAR"));
}

#[test]
fn pending_key_can_be_cancelled() {
    let mut c = coll();
    call(&gov(), 1, T0);
    c.propose_key(pk(2));
    c.revoke_key(2);
    assert!(get_logs().iter().any(|l| l.contains("key_revoked")));
    minted(&mut c, "1");
    let m = report("1", "testnet");
    call(&acc("svc.near"), 0, T0 + 4 * DAY);
    assert!(panics(|| c.attest("1".into(), m.clone(), sig(2, &m), 2)).contains("ERR_KEY_INACTIVE"));
}

#[test]
fn ninth_key_after_revocations_can_be_added() {
    let mut c = coll();
    call(&gov(), 1, T0);
    for n in 2..=8u8 {
        c.propose_key(pk(n));
    }
    assert!(panics(|| c.propose_key(pk(9))).contains("ERR_TOO_MANY_KEYS"));
    c.revoke_key(3);
    c.propose_key(pk(9));
    let ids: Vec<u16> = c.verifier_keys().iter().map(|k| k.id).collect();
    assert!(ids.contains(&9) && !ids.contains(&3));
    assert_eq!(c.revoked_keys().len(), 1);
}
