use crate::*;
use near_sdk::AccountId;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

type Mutation = Box<dyn Fn(&mut Terms)>;

const DAY: u64 = 86_400_000_000_000;
const NOW: u64 = 1_800_000_000_000_000_000;

fn cur() -> CurrencyConfig {
    CurrencyConfig {
        currency: Currency::Ft(acc("usdc.test.near")),
        decimals: 6,
        min_price: 1_000_000u128.into(),
        min_list: 100_000u128.into(),
        min_income: 10_000u128.into(),
        badge_min: 20_000_000u128.into(),
    }
}

pub(crate) fn sample_terms() -> Terms {
    Terms {
        price: 100_000_000u128.into(),
        currency: Currency::Ft(acc("usdc.test.near")),
        milestones: vec![Milestone { bps: 3000 }, Milestone { bps: 7000 }],
        deadline_ns: (NOW + 30 * DAY).into(),
        grace_ns: (2 * DAY).into(),
        review_window_ns: (7 * DAY).into(),
        revision_period_ns: (3 * DAY).into(),
        revision_rounds: 2,
        arbitrator: acc("arb.test.near"),
        fallback_arbitrator: acc("fallback.test.near"),
        timeout_artist_bps: DEFAULT_TIMEOUT_ARTIST_BPS,
        reject_bond_bps: DEFAULT_REJECT_BOND_BPS,
        royalty_bps: DEFAULT_ROYALTY_BPS,
        grant: Grant { kind: GrantType::CommercialNonExclusive, attribution: true, transferable: true },
        licence_text_hash: Bytes32([7u8; 32]),
        client: Some(acc("client.test.near")),
    }
}

fn check(t: &Terms) -> Result<(), TermsError> {
    t.validate(&acc("artist.test.near"), NOW, &TimeConfig::production(), &cur())
}

#[test]
fn defaults_match_spec() {
    assert_eq!(DEFAULT_TIMEOUT_ARTIST_BPS, 7500); // A22, confirmed
    assert_eq!(DEFAULT_ROYALTY_BPS, 500);
    assert_eq!(DEFAULT_REJECT_BOND_BPS, 500);
}

#[test]
fn terms_validate_bounds() {
    assert_eq!(check(&sample_terms()), Ok(()));
    let cases: Vec<(Mutation, TermsError)> = vec![
        (Box::new(|t| t.milestones.clear()), TermsError::MilestoneCount),
        (Box::new(|t| t.milestones = vec![Milestone { bps: 2000 }; 6]), TermsError::MilestoneCount),
        (Box::new(|t| t.milestones = vec![Milestone { bps: 5000 }, Milestone { bps: 4000 }]), TermsError::MilestoneSum),
        (Box::new(|t| t.milestones = vec![Milestone { bps: 0 }, Milestone { bps: 10000 }]), TermsError::MilestoneZero),
        (Box::new(|t| t.royalty_bps = 1501), TermsError::Royalty),
        (Box::new(|t| t.reject_bond_bps = 1001), TermsError::Bond),
        (Box::new(|t| t.timeout_artist_bps = 10001), TermsError::TimeoutBps),
        (Box::new(|t| t.grace_ns = (14 * DAY + 1).into()), TermsError::Grace),
        (Box::new(|t| t.review_window_ns = (3 * DAY - 1).into()), TermsError::ReviewWindow),
        (Box::new(|t| t.revision_period_ns = (DAY - 1).into()), TermsError::RevisionPeriod),
        (Box::new(|t| t.deadline_ns = (NOW + DAY).into()), TermsError::Deadline),
        (Box::new(|t| t.deadline_ns = (NOW + 365 * DAY + 1).into()), TermsError::Deadline),
        (Box::new(|t| t.price = 999_999u128.into()), TermsError::Price),
        (Box::new(|t| t.currency = Currency::Near), TermsError::Currency),
        (Box::new(|t| t.arbitrator = acc("artist.test.near")), TermsError::Arbitrator),
        (Box::new(|t| t.arbitrator = acc("client.test.near")), TermsError::Arbitrator),
        (Box::new(|t| t.fallback_arbitrator = acc("artist.test.near")), TermsError::Arbitrator),
        (Box::new(|t| t.fallback_arbitrator = acc("arb.test.near")), TermsError::Arbitrator),
        (Box::new(|t| t.client = Some(acc("artist.test.near"))), TermsError::Client),
        (Box::new(|t| t.revision_rounds = 11), TermsError::RevisionRounds),
    ];
    for (i, (mutate, want)) in cases.into_iter().enumerate() {
        let mut t = sample_terms();
        mutate(&mut t);
        assert_eq!(check(&t), Err(want), "case {i}");
    }
}

#[test]
fn terms_hash_changes_on_any_field() {
    let base = sample_terms().hash();
    let muts: Vec<Mutation> = vec![
        Box::new(|t| t.price = 100_000_001u128.into()),
        Box::new(|t| t.currency = Currency::Near),
        Box::new(|t| t.milestones[0].bps = 3001),
        Box::new(|t| t.deadline_ns = (t.deadline_ns.0 + 1).into()),
        Box::new(|t| t.grace_ns = (t.grace_ns.0 + 1).into()),
        Box::new(|t| t.review_window_ns = (t.review_window_ns.0 + 1).into()),
        Box::new(|t| t.revision_period_ns = (t.revision_period_ns.0 + 1).into()),
        Box::new(|t| t.revision_rounds = 3),
        Box::new(|t| t.arbitrator = acc("arb2.test.near")),
        Box::new(|t| t.fallback_arbitrator = acc("fb2.test.near")),
        Box::new(|t| t.timeout_artist_bps = 5000),
        Box::new(|t| t.reject_bond_bps = 400),
        Box::new(|t| t.royalty_bps = 600),
        Box::new(|t| t.grant.kind = GrantType::Personal),
        Box::new(|t| t.grant.attribution = false),
        Box::new(|t| t.grant.transferable = false),
        Box::new(|t| t.licence_text_hash = Bytes32([8u8; 32])),
        Box::new(|t| t.client = None),
    ];
    for (i, m) in muts.into_iter().enumerate() {
        let mut t = sample_terms();
        m(&mut t);
        assert_ne!(t.hash(), base, "field {i} not covered by hash");
    }
}

#[test]
fn grant_types_ordered_by_width() {
    assert!(GrantType::Personal < GrantType::CommercialNonExclusive);
    assert!(GrantType::CommercialNonExclusive < GrantType::CommercialExclusive);
    assert!(GrantType::CommercialExclusive < GrantType::FullAssignment);
}

fn borsh_str(out: &mut Vec<u8>, s: &str) {
    out.extend((s.len() as u32).to_le_bytes());
    out.extend(s.as_bytes());
}

fn write_vector(name: &str, json: serde_json::Value) {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("test-vectors");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(name), serde_json::to_string_pretty(&json).unwrap() + "\n").unwrap();
}

fn sample_report() -> ReportMessage {
    ReportMessage::new(
        "testnet".into(),
        acc("p7.soulprint-v1.x.testnet"),
        Bytes32([1; 32]),
        Bytes32([2; 32]),
        42,
        Bytes32([3; 32]),
        2,
        Bytes32([4; 32]),
        1_800_000_000_000_000_000,
        Bytes32([5; 32]),
    )
}

#[test]
fn report_message_test_vector() {
    let m = sample_report();
    // Hand-built layout: field order is normative and shared with Plan 2 (TypeScript).
    let mut want = Vec::new();
    borsh_str(&mut want, "soulprint-report-v1");
    borsh_str(&mut want, "testnet");
    borsh_str(&mut want, "p7.soulprint-v1.x.testnet");
    want.extend([1u8; 32]);
    want.extend([2u8; 32]);
    want.extend(42u32.to_le_bytes());
    want.extend([3u8; 32]);
    want.push(2);
    want.extend([4u8; 32]);
    want.extend(1_800_000_000_000_000_000u64.to_le_bytes());
    want.extend([5u8; 32]);
    assert_eq!(m.signing_bytes(), want);
    write_vector(
        "report-v1.json",
        serde_json::json!({ "message": m, "borsh_hex": hex::encode(&want) }),
    );
}

#[test]
fn anchor_message_test_vector() {
    let m = AnchorMessage::new(acc("p7.soulprint-v1.x.testnet"), Bytes32([9; 32]), 17);
    let mut want = Vec::new();
    borsh_str(&mut want, "soulprint-anchor-v1");
    borsh_str(&mut want, "p7.soulprint-v1.x.testnet");
    want.extend([9u8; 32]);
    want.extend(17u32.to_le_bytes());
    assert_eq!(m.signing_bytes(), want);
    write_vector("anchor-v1.json", serde_json::json!({ "message": m, "borsh_hex": hex::encode(&want) }));
}

#[test]
fn batch_message_test_vector() {
    let m = BatchMessage::new(acc("p7.soulprint-v1.x.testnet"), Bytes32([6; 32]), 3, 9, Bytes32([8; 32]));
    let mut want = Vec::new();
    borsh_str(&mut want, "soulprint-batch-v1");
    borsh_str(&mut want, "p7.soulprint-v1.x.testnet");
    want.extend([6u8; 32]);
    want.extend(3u32.to_le_bytes());
    want.extend(9u32.to_le_bytes());
    want.extend([8u8; 32]);
    assert_eq!(m.signing_bytes(), want);
    write_vector("batch-v1.json", serde_json::json!({ "message": m, "borsh_hex": hex::encode(&want) }));
}

#[test]
fn challenge_ack_message_test_vector() {
    let m = ChallengeAckMessage::new(acc("p7.soulprint-v1.x.testnet"), 4, Bytes32([1; 32]));
    let mut want = Vec::new();
    borsh_str(&mut want, "soulprint-challenge-ack-v1");
    borsh_str(&mut want, "p7.soulprint-v1.x.testnet");
    want.extend(4u32.to_le_bytes());
    want.extend([1u8; 32]);
    assert_eq!(m.signing_bytes(), want);
    write_vector("challenge-ack-v1.json", serde_json::json!({ "message": m, "borsh_hex": hex::encode(&want) }));
}

#[test]
fn genesis_test_vector() {
    use sha2::Digest;
    let piece = acc("p7.soulprint-v1.x.testnet");
    let pk = [3u8; 32];
    let mut h = sha2::Sha256::new();
    h.update(piece.as_bytes());
    h.update(pk);
    let want: [u8; 32] = h.finalize().into();
    assert_eq!(genesis(&piece, &Bytes32(pk)).0, want);
    // chain link: link_i = sha256(link_{i-1} ‖ frame_hash_i)
    let f = [0xabu8; 32];
    let mut h2 = sha2::Sha256::new();
    h2.update(want);
    h2.update(f);
    let l1: [u8; 32] = h2.finalize().into();
    assert_eq!(chain_link(&Bytes32(want), &Bytes32(f)).0, l1);
    write_vector(
        "genesis-v1.json",
        serde_json::json!({
            "piece_id": piece, "capture_pubkey_hex": hex::encode(pk), "genesis_hex": hex::encode(want),
            "frame_hash_hex": hex::encode(f), "link1_hex": hex::encode(l1)
        }),
    );
}

#[test]
fn signature_over_report_verifies_with_dalek() {
    use ed25519_dalek::{Signer, SigningKey};
    let sk = SigningKey::from_bytes(&[11u8; 32]);
    let m = sample_report();
    let sig = sk.sign(&m.signing_bytes());
    assert!(sk.verifying_key().verify_strict(&m.signing_bytes(), &sig).is_ok());
}

#[test]
fn bytes32_json_is_base64_and_length_checked() {
    let b = Bytes32([0xff; 32]);
    let s = serde_json::to_string(&b).unwrap();
    assert_eq!(s, format!("\"{}\"", near_sdk::base64::Engine::encode(&near_sdk::base64::engine::general_purpose::STANDARD, [0xffu8; 32])));
    assert_eq!(serde_json::from_str::<Bytes32>(&s).unwrap(), b);
    let short = format!("\"{}\"", near_sdk::base64::Engine::encode(&near_sdk::base64::engine::general_purpose::STANDARD, [1u8; 31]));
    assert!(serde_json::from_str::<Bytes32>(&short).is_err());
    let sig = Bytes64([1; 64]);
    let s = serde_json::to_string(&sig).unwrap();
    assert_eq!(serde_json::from_str::<Bytes64>(&s).unwrap(), sig);
}

#[test]
fn piece_kind_json_shape() {
    let k = PieceKind::Standalone(StandaloneTerms {
        currency: Currency::Near,
        royalty_bps: 500,
        grant: Grant { kind: GrantType::Personal, attribution: true, transferable: false },
        licence_text_hash: Bytes32([0; 32]),
    });
    let v = serde_json::to_value(&k).unwrap();
    assert!(v.get("Standalone").is_some(), "{v}");
    let back: PieceKind = serde_json::from_value(v).unwrap();
    assert_eq!(back, k);
    let c = serde_json::to_value(Currency::Ft(acc("usdc.test.near"))).unwrap();
    assert_eq!(c, serde_json::json!({"Ft": "usdc.test.near"}));
    assert_eq!(serde_json::to_value(Currency::Near).unwrap(), serde_json::json!("Near"));
}

#[test]
fn time_config_fast_is_seconds_scale() {
    let f = TimeConfig::fast();
    let p = TimeConfig::production();
    assert!(f.review_min < p.review_min);
    assert!(f.negotiation <= 60 * 1_000_000_000);
    assert_eq!(p.negotiation, 7 * DAY);
    assert_eq!(p.arbitration, 14 * DAY);
    assert_eq!(p.fallback, 14 * DAY);
    assert_eq!(p.pending_expiry, DAY);
    assert_eq!(p.key_timelock, 3 * DAY);
    assert_eq!(p.challenge_window, 10 * 60 * 1_000_000_000);
    assert_eq!(p.challenge_min_interval, 30 * 60 * 1_000_000_000);
    assert_eq!(p.grace_max, 14 * DAY);
    assert_eq!(p.review_min, 3 * DAY);
    assert_eq!(p.deadline_min_lead, DAY);
    assert_eq!(p.deadline_max, 365 * DAY);
    assert_eq!(p.fund_cutoff, DAY);
}

#[test]
fn event_json_is_nep297() {
    let e = SoulprintEvent::OwnerChanged {
        piece_id: acc("p7.soulprint-v1.x.testnet"),
        old_owner: acc("artist.test.near"),
        new_owner: acc("client.test.near"),
        seq: 2u64.into(),
        cause: OwnerChangeCause::Fund,
    };
    let v: serde_json::Value = serde_json::from_str(e.to_log().strip_prefix("EVENT_JSON:").unwrap()).unwrap();
    assert_eq!(v["standard"], "soulprint");
    assert_eq!(v["version"], "1.0.0");
    assert_eq!(v["event"], "owner_changed");
    assert_eq!(v["data"][0]["seq"], "2");
    assert_eq!(v["data"][0]["cause"], "fund");
}

#[test]
fn abi_fixtures_roundtrip() {
    // One sample per event; written to contracts/abi/events.json and read back.
    let samples = SoulprintEvent::samples();
    let names: std::collections::BTreeSet<String> = samples.iter().map(|e| e.name()).collect();
    assert_eq!(names.len(), samples.len(), "duplicate sample");
    for required in [
        "piece_created", "funded", "owner_changed", "transfer_pending", "transfer_reverted", "bond_posted",
        "bond_paid", "addendum_proposed", "addendum_accepted", "challenger_invited", "key_proposed",
        "key_activated", "key_revoked", "anchored", "challenge_issued", "challenge_acked", "delivered",
        "changes_requested", "milestone_released", "settled", "rejected", "split_proposed", "resolved",
        "refunded", "cancelled", "deadline_extended", "income", "withdraw", "claim", "claim_restored",
        "listed", "delisted", "sold", "attested", "capture_key_added", "reopened_standalone",
    ] {
        assert!(names.contains(required), "missing event sample {required}");
    }
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../abi");
    std::fs::create_dir_all(&dir).unwrap();
    let logs: Vec<serde_json::Value> = samples
        .iter()
        .map(|e| serde_json::from_str(e.to_log().strip_prefix("EVENT_JSON:").unwrap()).unwrap())
        .collect();
    let path = dir.join("events.json");
    std::fs::write(&path, serde_json::to_string_pretty(&logs).unwrap() + "\n").unwrap();
    let back: Vec<serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    for (v, e) in back.iter().zip(samples.iter()) {
        let parsed: SoulprintEvent = SoulprintEvent::from_nep297(v).unwrap();
        assert_eq!(&parsed, e);
    }
    // Types used in method args, as JSON samples.
    let types = serde_json::json!({
        "Terms": sample_terms(),
        "PieceKind.Commission": PieceKind::Commission(sample_terms()),
        "CurrencyConfig": cur(),
        "TimeConfig.production": TimeConfig::production(),
        "ReportMessage": sample_report(),
    });
    std::fs::write(dir.join("types.json"), serde_json::to_string_pretty(&types).unwrap() + "\n").unwrap();
}
