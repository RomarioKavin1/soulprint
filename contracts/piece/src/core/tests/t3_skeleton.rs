use super::*;

#[test]
fn new_commission_owner_is_artist_status_offered() {
    let p = new_piece(&cur_ft());
    assert_eq!(p.owner, artist());
    assert_eq!(p.artist, artist());
    assert_eq!(p.status, Status::Offered);
    assert_eq!(p.rotation_seq, 0);
    assert_eq!(p.mode, Mode::Commission);
    assert_eq!(p.terms_hash, Some(terms(&cur_ft()).hash()));
    assert_eq!(p.capture_keys, vec![capture_pk()]);
    assert_eq!(p.segments.len(), 1);
    assert_eq!(p.segments[0].head, genesis(&piece_id(), &capture_pk()));
    assert_eq!(p.segments[0].count, 0);
}

#[test]
fn new_commission_prefunds_credit_slots_artist_client_arbitrators() {
    let p = new_piece(&cur_ft());
    for a in [artist(), client(), arb(), fallback()] {
        let s = p.credits.get(&a).unwrap_or_else(|| panic!("no slot for {a}"));
        assert!(s.prefunded);
        assert_eq!((s.available, s.in_flight), (0, 0));
    }
    assert_eq!(p.credits.len(), 4);
}

#[test]
fn new_rejects_invalid_terms() {
    let mut t = terms(&cur_ft());
    t.royalty_bps = 2000;
    let r = PieceCore::new(piece_id(), collection(), artist(), PieceKind::Commission(t), capture_pk(),
        TimeConfig::production(), cur_ft(), T0);
    assert_eq!(r.err(), Some(Error::Terms(TermsError::Royalty)));
}

#[test]
fn new_standalone_has_no_terms_and_artist_slot_only() {
    let st = StandaloneTerms {
        currency: Currency::Near, royalty_bps: 500,
        grant: Grant { kind: GrantType::Personal, attribution: true, transferable: true },
        licence_text_hash: Bytes32([0; 32]),
    };
    let p = PieceCore::new(piece_id(), collection(), artist(), PieceKind::Standalone(st), capture_pk(),
        TimeConfig::production(), cur_near(), T0).unwrap();
    assert_eq!(p.mode, Mode::Standalone);
    assert!(p.terms.is_none());
    assert_eq!(p.owner, artist());
    assert_eq!(p.credits.len(), 1);
}

#[test]
fn gated_methods_require_at_least_one_yocto() {
    let p = new_piece(&cur_ft());
    assert_eq!(p.require_yocto(&cx(&artist(), 0, T0)), Err(Error::RequiresDeposit));
    assert_eq!(p.require_yocto(&cx(&artist(), 1, T0)), Ok(()));
    assert_eq!(p.require_yocto(&cx(&artist(), 2, T0)), Ok(()));
    // FT action contexts never satisfy a NEAR-deposit gate.
    assert_eq!(p.require_yocto(&fx_ft(&artist(), 5, T0)), Err(Error::RequiresDeposit));
}

#[test]
fn auth_helpers() {
    let p = new_piece(&cur_ft());
    assert_eq!(p.require_artist(&cx(&artist(), 1, T0)), Ok(()));
    assert_eq!(p.require_artist(&cx(&client(), 1, T0)), Err(Error::NotArtist));
    assert_eq!(p.require_owner(&cx(&artist(), 1, T0)), Ok(()));
    assert_eq!(p.require_owner(&cx(&client(), 1, T0)), Err(Error::NotOwner));
    assert_eq!(p.require_collection(&cx(&collection(), 0, T0)), Ok(()));
    assert_eq!(p.require_collection(&cx(&artist(), 0, T0)), Err(Error::NotCollection));
    assert_eq!(p.require_not_pending(), Ok(()));
}

#[test]
fn value_requires_matching_currency() {
    let ft = new_piece(&cur_ft());
    assert_eq!(ft.value(&fx_ft(&client(), 9, T0)), Ok(9));
    assert_eq!(ft.value(&cx(&client(), 9, T0)), Err(Error::WrongCurrency));
    let mut wrong = fx_ft(&client(), 9, T0);
    wrong.token = Some(acc("evil.near"));
    assert_eq!(ft.value(&wrong), Err(Error::WrongCurrency));
    let nr = new_piece(&cur_near());
    assert_eq!(nr.value(&cx(&client(), 9, T0)), Ok(9));
    assert_eq!(nr.value(&fx_ft(&client(), 9, T0)), Err(Error::WrongCurrency));
}

#[test]
fn error_display_is_stable() {
    assert_eq!(Error::NotOwner.to_string(), "ERR_NOT_OWNER");
    assert_eq!(Error::Terms(TermsError::Royalty).to_string(), "ERR_TERMS_Royalty");
}
