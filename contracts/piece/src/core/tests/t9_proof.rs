use super::*;

fn head(n: u8) -> Bytes32 { Bytes32([n; 32]) }

fn anchor(p: &mut PieceCore, count: u32, now: u64) -> Res {
    let h = head(count as u8);
    p.anchor(&cx(&stranger(), 0, now), &Dalek, capture_pk(), h, count, anchor_sig(&capture_sk(), h, count))
}

#[test]
fn anchor_requires_capture_key_signature() {
    let mut p = funded(&cur_ft());
    let other = ed25519_dalek::SigningKey::from_bytes(&[7u8; 32]);
    let h = head(1);
    let bad = anchor_sig(&other, h, 1);
    assert_eq!(p.anchor(&cx(&stranger(), 0, FUND_AT), &Dalek, capture_pk(), h, 1, bad), Err(Error::BadSignature));
    let other_pk = Bytes32(other.verifying_key().to_bytes());
    assert_eq!(p.anchor(&cx(&stranger(), 0, FUND_AT), &Dalek, other_pk, h, 1, anchor_sig(&other, h, 1)), Err(Error::UnknownKey));
    let fx = anchor(&mut p, 1, FUND_AT).unwrap();
    assert!(has_event(&fx, "anchored"));
    assert_eq!((p.segments[0].head, p.segments[0].count), (h, 1));
    // A signature for a different count does not verify.
    let sig = anchor_sig(&capture_sk(), head(2), 2);
    assert_eq!(p.anchor(&cx(&stranger(), 0, FUND_AT), &Dalek, capture_pk(), head(2), 3, sig), Err(Error::BadSignature));
}

#[test]
fn anchor_count_monotonic() {
    let mut p = funded(&cur_ft());
    anchor(&mut p, 5, FUND_AT).unwrap();
    assert_eq!(anchor(&mut p, 5, FUND_AT), Err(Error::AnchorNotMonotonic));
    assert_eq!(anchor(&mut p, 4, FUND_AT), Err(Error::AnchorNotMonotonic));
    anchor(&mut p, 6, FUND_AT).unwrap();
}

#[test]
fn anchor_cap_enforced() {
    let mut p = funded(&cur_ft());
    p.anchors_total = MAX_ANCHORS - 1;
    anchor(&mut p, 1, FUND_AT).unwrap();
    assert_eq!(anchor(&mut p, 2, FUND_AT), Err(Error::TooManyAnchors));
}

#[test]
fn anchor_only_while_recording() {
    let mut p = settled_piece(&cur_ft());
    assert_eq!(anchor(&mut p, 1, SETTLED_AT + 1), Err(Error::WrongStatus));
    let mut q = new_piece(&cur_ft());
    anchor(&mut q, 1, T0 + 1).unwrap();
}

#[test]
fn second_capture_key_has_own_segment() {
    let mut p = funded(&cur_ft());
    let k2 = ed25519_dalek::SigningKey::from_bytes(&[8u8; 32]);
    let pk2 = Bytes32(k2.verifying_key().to_bytes());
    assert_eq!(p.add_capture_key(&cx(&client(), 1, FUND_AT), pk2), Err(Error::NotArtist));
    p.add_capture_key(&cx(&artist(), 1, FUND_AT), pk2).unwrap();
    assert_eq!(p.add_capture_key(&cx(&artist(), 1, FUND_AT), pk2), Err(Error::DuplicateKey), "duplicate");
    assert_eq!(p.segments[1].head, genesis(&piece_id(), &pk2));
    let h = head(9);
    p.anchor(&cx(&stranger(), 0, FUND_AT), &Dalek, pk2, h, 1, anchor_sig(&k2, h, 1)).unwrap();
    assert_eq!(p.segments[1].count, 1);
    assert_eq!(p.segments[0].count, 0);
    for i in 3..=4u8 {
        p.add_capture_key(&cx(&artist(), 1, FUND_AT), Bytes32([i; 32])).unwrap();
    }
    assert_eq!(p.add_capture_key(&cx(&artist(), 1, FUND_AT), Bytes32([5; 32])), Err(Error::TooManyKeys));
}

// ---------- challenges ----------

const MIN_INTERVAL: u64 = 30 * 60 * SEC;
const WINDOW: u64 = 10 * 60 * SEC;

fn issue(p: &mut PieceCore, who: &AccountId, now: u64) -> Res {
    p.issue_challenge(&cx(who, 1, now), Bytes32([now as u8; 32]))
}

#[test]
fn challenge_only_client_or_invited() {
    let mut p = funded(&cur_ft());
    assert_eq!(issue(&mut p, &stranger(), FUND_AT), Err(Error::NotChallenger));
    assert_eq!(issue(&mut p, &artist(), FUND_AT), Err(Error::NotChallenger));
    let fx = issue(&mut p, &client(), FUND_AT).unwrap();
    assert!(fx.iter().any(|e| matches!(e, Effect::Event(SoulprintEvent::ChallengeIssued { issuer_class: IssuerClass::Client, .. }))));
    p.invite_challenger(&cx(&artist(), 1, FUND_AT), acc("judge.near")).unwrap();
    let fx = issue(&mut p, &acc("judge.near"), FUND_AT + MIN_INTERVAL).unwrap();
    assert!(fx.iter().any(|e| matches!(e, Effect::Event(SoulprintEvent::ChallengeIssued { issuer_class: IssuerClass::Invited, .. }))));
}

#[test]
fn invites_capped_and_artist_only() {
    let mut p = funded(&cur_ft());
    assert_eq!(p.invite_challenger(&cx(&client(), 1, FUND_AT), acc("j.near")), Err(Error::NotArtist));
    assert_eq!(p.invite_challenger(&cx(&artist(), 1, FUND_AT), artist()), Err(Error::NotChallenger));
    for i in 0..MAX_INVITES {
        p.invite_challenger(&cx(&artist(), 1, FUND_AT), acc(&format!("j{i}.near"))).unwrap();
    }
    assert_eq!(p.invite_challenger(&cx(&artist(), 1, FUND_AT), acc("j0.near")), Err(Error::AlreadyInvited));
    assert_eq!(p.invite_challenger(&cx(&artist(), 1, FUND_AT), acc("extra.near")), Err(Error::TooManyInvites));
}

#[test]
fn one_open_challenge() {
    let mut p = funded(&cur_ft());
    p.invite_challenger(&cx(&artist(), 1, FUND_AT), acc("judge.near")).unwrap();
    issue(&mut p, &client(), FUND_AT).unwrap();
    assert_eq!(issue(&mut p, &acc("judge.near"), FUND_AT + 1), Err(Error::ChallengeOpen));
}

#[test]
fn challenge_rate_limited() {
    let mut p = funded(&cur_ft());
    issue(&mut p, &client(), FUND_AT).unwrap();
    assert_eq!(issue(&mut p, &client(), FUND_AT + MIN_INTERVAL - 1), Err(Error::ChallengeTooSoon));
    issue(&mut p, &client(), FUND_AT + MIN_INTERVAL).unwrap();
}

#[test]
fn per_issuer_cap() {
    let mut p = funded(&cur_ft());
    let mut now = FUND_AT;
    for _ in 0..MAX_CHALLENGES_PER_ISSUER {
        issue(&mut p, &client(), now).unwrap();
        now += MIN_INTERVAL;
    }
    assert_eq!(issue(&mut p, &client(), now), Err(Error::TooManyChallenges));
    p.invite_challenger(&cx(&artist(), 1, now), acc("judge.near")).unwrap();
    issue(&mut p, &acc("judge.near"), now).unwrap();
}

#[test]
fn challenge_ack_starts_window() {
    let mut p = funded(&cur_ft());
    issue(&mut p, &client(), FUND_AT).unwrap();
    let nonce = p.challenges[0].nonce_hash;
    let msg = ChallengeAckMessage::new(piece_id(), 0, nonce).signing_bytes();
    let bad = sign(&ed25519_dalek::SigningKey::from_bytes(&[1u8; 32]), &msg);
    assert_eq!(p.ack_challenge(&cx(&stranger(), 0, FUND_AT + 5), &Dalek, 0, bad), Err(Error::BadSignature));
    assert_eq!(p.ack_challenge(&cx(&stranger(), 0, FUND_AT + 5), &Dalek, 1, sign(&capture_sk(), &msg)), Err(Error::NoSuchChallenge));
    let fx = p.ack_challenge(&cx(&stranger(), 0, FUND_AT + 5), &Dalek, 0, sign(&capture_sk(), &msg)).unwrap();
    assert!(has_event(&fx, "challenge_acked"));
    assert_eq!(p.challenges[0].acked_at, Some(FUND_AT + 5));
    assert_eq!(p.ack_challenge(&cx(&stranger(), 0, FUND_AT + 6), &Dalek, 0, sign(&capture_sk(), &msg)), Err(Error::ChallengeClosed));
    // Window counts from the ack: still open just before ack + window.
    p.invite_challenger(&cx(&artist(), 1, FUND_AT), acc("judge.near")).unwrap();
    assert_eq!(issue(&mut p, &acc("judge.near"), FUND_AT + 5 + WINDOW - 1), Err(Error::ChallengeOpen));
}

#[test]
fn unacked_challenge_expires() {
    let mut p = funded(&cur_ft());
    issue(&mut p, &client(), FUND_AT).unwrap();
    let nonce = p.challenges[0].nonce_hash;
    let msg = ChallengeAckMessage::new(piece_id(), 0, nonce).signing_bytes();
    assert_eq!(p.ack_challenge(&cx(&stranger(), 0, FUND_AT + WINDOW), &Dalek, 0, sign(&capture_sk(), &msg)), Err(Error::ChallengeClosed));
}

// ---------- attestation ----------

fn report(p: &PieceCore, level: u8, issued_at: u64) -> ReportMessage {
    let seg = &p.segments[0];
    let (h, c) = if level == LEVEL_E0 { (Bytes32::ZERO, 0) } else { (seg.head, seg.count) };
    ReportMessage::new("testnet".into(), piece_id(), p.final_file_hash.unwrap(), h, c, capture_pk(), level,
        p.report_hash.unwrap(), issued_at, p.segments_digest())
}

fn recorded_and_delivered() -> PieceCore {
    let mut p = funded(&cur_ft());
    anchor(&mut p, 3, FUND_AT + 1).unwrap();
    p.deliver(&cx(&artist(), 1, DELIVER_AT), Bytes32([0xf1; 32]), Bytes32([0xe1; 32])).unwrap();
    p
}

#[test]
fn attestation_only_from_collection() {
    let mut p = recorded_and_delivered();
    let m = report(&p, LEVEL_E2, 5);
    assert_eq!(p.record_attestation(&cx(&artist(), 0, DELIVER_AT + 1), m.clone(), 1), Err(Error::NotCollection));
    let fx = p.record_attestation(&cx(&collection(), 0, DELIVER_AT + 1), m, 1).unwrap();
    assert!(has_event(&fx, "attested"));
    assert_eq!((p.attestation.evidence_level, p.attestation.key_id, p.attestation.attested_at), (LEVEL_E2, 1, DELIVER_AT + 1));
}

#[test]
fn attestation_report_hash_must_match() {
    let mut p = recorded_and_delivered();
    let mut m = report(&p, LEVEL_E2, 5);
    m.report_hash = Bytes32([0; 32]);
    assert_eq!(p.record_attestation(&cx(&collection(), 0, DELIVER_AT + 1), m, 1), Err(Error::ReportMismatch));
}

#[test]
fn attestation_bound_to_final_file_hash() {
    let mut p = recorded_and_delivered();
    let mut m = report(&p, LEVEL_E2, 5);
    m.final_file_hash = Bytes32([0; 32]);
    assert_eq!(p.record_attestation(&cx(&collection(), 0, DELIVER_AT + 1), m, 1), Err(Error::ReportMismatch));
    let mut m2 = report(&p, LEVEL_E2, 5);
    m2.piece_id = acc("p2.soulprint-v1.near");
    assert_eq!(p.record_attestation(&cx(&collection(), 0, DELIVER_AT + 1), m2, 1), Err(Error::WrongPiece));
}

#[test]
fn attestation_bound_to_anchor_head() {
    let mut p = recorded_and_delivered();
    for m in [
        { let mut m = report(&p, LEVEL_E2, 5); m.last_anchor_head = head(9); m },
        { let mut m = report(&p, LEVEL_E2, 5); m.last_anchor_count = 2; m },
        { let mut m = report(&p, LEVEL_E2, 5); m.segments_digest = Bytes32([0; 32]); m },
        { let mut m = report(&p, LEVEL_E2, 5); m.capture_pubkey = Bytes32([3; 32]); m },
        { let mut m = report(&p, LEVEL_E0, 5); m.last_anchor_count = 3; m },
        report(&p, 1, 5), // E1 removed (A32)
    ] {
        assert_eq!(p.record_attestation(&cx(&collection(), 0, DELIVER_AT + 1), m, 1), Err(Error::ReportMismatch));
    }
    p.record_attestation(&cx(&collection(), 0, DELIVER_AT + 1), report(&p, LEVEL_E0, 5), 1).unwrap();
}

#[test]
fn older_attestation_cannot_replace_newer() {
    let mut p = recorded_and_delivered();
    p.record_attestation(&cx(&collection(), 0, DELIVER_AT + 1), report(&p, LEVEL_E3, 10), 1).unwrap();
    assert_eq!(p.record_attestation(&cx(&collection(), 0, DELIVER_AT + 2), report(&p, LEVEL_E0, 10), 1), Err(Error::StaleReport));
    assert_eq!(p.record_attestation(&cx(&collection(), 0, DELIVER_AT + 2), report(&p, LEVEL_E0, 9), 1), Err(Error::StaleReport));
    p.record_attestation(&cx(&collection(), 0, DELIVER_AT + 2), report(&p, LEVEL_E2, 11), 2).unwrap();
    assert_eq!(p.attestation.evidence_level, LEVEL_E2);
}

#[test]
fn redeliver_clears_attestation() {
    let mut p = recorded_and_delivered();
    p.record_attestation(&cx(&collection(), 0, DELIVER_AT + 1), report(&p, LEVEL_E2, 10), 1).unwrap();
    p.request_changes(&cx(&client(), 1, DELIVER_AT + 2)).unwrap();
    p.deliver(&cx(&artist(), 1, DELIVER_AT + 3), Bytes32([0xf2; 32]), Bytes32([0xe2; 32])).unwrap();
    assert_eq!(p.attestation, Attestation::default());
    p.record_attestation(&cx(&collection(), 0, DELIVER_AT + 4), report(&p, LEVEL_E2, 1), 1).unwrap();
}

#[test]
fn attestation_needs_delivery() {
    let mut p = funded(&cur_ft());
    p.final_file_hash = None;
    let m = ReportMessage::new("testnet".into(), piece_id(), Bytes32([1; 32]), Bytes32::ZERO, 0, capture_pk(), 0, Bytes32([1; 32]), 1, p.segments_digest());
    assert_eq!(p.record_attestation(&cx(&collection(), 0, FUND_AT + 1), m, 1), Err(Error::WrongStatus));
}

#[test]
fn standalone_can_be_attested() {
    let st = StandaloneTerms {
        currency: Currency::Near, royalty_bps: 500,
        grant: Grant { kind: GrantType::Personal, attribution: true, transferable: true },
        licence_text_hash: Bytes32([0; 32]),
    };
    let mut p = PieceCore::new(piece_id(), collection(), artist(), PieceKind::Standalone(st), capture_pk(),
        TimeConfig::production(), cur_near(), T0).unwrap();
    anchor(&mut p, 4, T0 + 1).unwrap();
    p.settle_standalone(&cx(&artist(), 1, T0 + 2), Bytes32([0xf1; 32]), Bytes32([0xe1; 32])).unwrap();
    p.record_attestation(&cx(&collection(), 0, T0 + 3), report(&p, LEVEL_E2, 1), 1).unwrap();
    assert_eq!(p.attestation.evidence_level, LEVEL_E2);
}

// ---------- addenda ----------

fn wider() -> Grant {
    Grant { kind: GrantType::CommercialExclusive, attribution: true, transferable: true }
}

#[test]
fn addendum_must_widen() {
    let mut p = settled_piece(&cur_ft());
    let same = p.grant;
    assert_eq!(p.propose_addendum(&cx(&artist(), 1, SETTLED_AT), same, Bytes32([1; 32])), Err(Error::AddendumNotWider));
    let narrower = Grant { kind: GrantType::Personal, ..same };
    assert_eq!(p.propose_addendum(&cx(&artist(), 1, SETTLED_AT), narrower, Bytes32([1; 32])), Err(Error::AddendumNotWider));
    let mixed = Grant { kind: GrantType::FullAssignment, transferable: false, ..same };
    assert_eq!(p.propose_addendum(&cx(&artist(), 1, SETTLED_AT), mixed, Bytes32([1; 32])), Err(Error::AddendumNotWider));
    let fx = p.propose_addendum(&cx(&artist(), 1, SETTLED_AT), wider(), Bytes32([1; 32])).unwrap();
    assert!(has_event(&fx, "addendum_proposed"));
}

#[test]
fn addendum_requires_holder() {
    let mut p = settled_piece(&cur_ft());
    p.propose_addendum(&cx(&artist(), 1, SETTLED_AT), wider(), Bytes32([1; 32])).unwrap();
    assert_eq!(p.accept_addendum(&cx(&artist(), 1, SETTLED_AT), Bytes32([1; 32])), Err(Error::NotOwner));
    assert_eq!(p.accept_addendum(&cx(&client(), 1, SETTLED_AT), Bytes32([2; 32])), Err(Error::AddendumChanged));
    let fx = p.accept_addendum(&cx(&client(), 1, SETTLED_AT), Bytes32([1; 32])).unwrap();
    assert!(has_event(&fx, "addendum_accepted"));
    assert_eq!(p.grant, wider());
    assert_eq!(p.addenda.len(), 1);
    assert!(p.pending_addendum.is_none());
    assert_eq!(p.accept_addendum(&cx(&client(), 1, SETTLED_AT), Bytes32([1; 32])), Err(Error::NoAddendum));
}

#[test]
fn addendum_pending_is_replaceable_and_cap_counts_accepted() {
    let mut p = settled_piece(&cur_ft());
    p.propose_addendum(&cx(&artist(), 1, SETTLED_AT), wider(), Bytes32([1; 32])).unwrap();
    p.propose_addendum(&cx(&artist(), 1, SETTLED_AT), wider(), Bytes32([2; 32])).unwrap();
    assert_eq!(p.accept_addendum(&cx(&client(), 1, SETTLED_AT), Bytes32([1; 32])), Err(Error::AddendumChanged));
    p.addenda = vec![Addendum { grant: p.grant, text_hash: Bytes32::ZERO }; MAX_ADDENDA];
    assert_eq!(p.accept_addendum(&cx(&client(), 1, SETTLED_AT), Bytes32([2; 32])), Err(Error::TooManyAddenda));
}

#[test]
fn addendum_blocked_while_listed() {
    let mut p = listed_piece();
    assert_eq!(p.propose_addendum(&cx(&artist(), 1, SETTLED_AT + 2), wider(), Bytes32([1; 32])), Err(Error::Listed));
    p.delist(&cx(&client(), 1, SETTLED_AT + 2)).unwrap();
    p.propose_addendum(&cx(&artist(), 1, SETTLED_AT + 3), wider(), Bytes32([1; 32])).unwrap();
    p.list(&cx(&client(), 1, SETTLED_AT + 4), LIST_PRICE, None).unwrap();
    assert_eq!(p.accept_addendum(&cx(&client(), 1, SETTLED_AT + 5), Bytes32([1; 32])), Err(Error::Listed));
}

#[test]
fn terms_hash_immutable_after_fund() {
    let mut p = settled_piece(&cur_ft());
    let h = p.terms_hash;
    let t = p.terms.clone();
    p.propose_addendum(&cx(&artist(), 1, SETTLED_AT), wider(), Bytes32([1; 32])).unwrap();
    p.accept_addendum(&cx(&client(), 1, SETTLED_AT), Bytes32([1; 32])).unwrap();
    assert_eq!(p.terms_hash, h);
    assert_eq!(p.terms, t);
    assert_eq!(p.terms_hash, Some(p.terms.as_ref().unwrap().hash()));
}
