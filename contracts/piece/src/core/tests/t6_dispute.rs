use super::*;

const NEG_END: u64 = REJECT_AT + 7 * DAY;
const ARB_END: u64 = REJECT_AT + 21 * DAY;
const FB_END: u64 = REJECT_AT + 35 * DAY;

#[test]
fn reject_with_ft_bond() {
    let mut p = delivered_piece(&cur_ft());
    assert_eq!(p.reject(&fx_ft(&client(), BOND - 1, REJECT_AT)), Err(Error::WrongAmount));
    assert_eq!(p.reject(&fx_ft(&artist(), BOND, REJECT_AT)), Err(Error::NotOwner));
    let fx = p.reject(&fx_ft(&client(), BOND, REJECT_AT)).unwrap();
    assert_eq!(p.status, Status::Disputed);
    assert_eq!(p.bond, BOND);
    assert_eq!(p.disputed_at, Some(REJECT_AT));
    assert!(has_event(&fx, "rejected") && has_event(&fx, "bond_posted"));
}

#[test]
fn reject_with_near_bond() {
    let cur = cur_near();
    let mut p = delivered_piece(&cur);
    let bond = price_for(&cur) * 500 / 10_000;
    assert_eq!(p.reject(&fx_ft(&client(), bond, REJECT_AT)), Err(Error::WrongCurrency));
    p.reject(&cx(&client(), bond, REJECT_AT)).unwrap();
    assert_eq!(p.bond, bond);
}

#[test]
fn reject_after_window_fails_without_settle_poke() {
    let mut p = delivered_piece(&cur_ft());
    let before = p.clone();
    let end = DELIVER_AT + 7 * DAY;
    assert_eq!(p.reject(&fx_ft(&client(), BOND, end)), Err(Error::WrongStatus));
    assert_eq!(p, before);
    p.reject(&fx_ft(&client(), BOND, end - 1)).unwrap();
}

#[test]
fn bond_counted_in_liabilities() {
    let p = disputed_piece();
    assert_eq!(p.liabilities(), PRICE + BOND);
}

#[test]
fn split_requires_counterparty_acceptance() {
    let mut p = disputed_piece();
    p.propose_split(&cx(&artist(), 1, REJECT_AT + 1), 6000).unwrap();
    assert_eq!(p.accept_split(&cx(&artist(), 1, REJECT_AT + 2), 6000, 1), Err(Error::OwnProposal));
    assert_eq!(p.accept_split(&cx(&stranger(), 1, REJECT_AT + 2), 6000, 1), Err(Error::NotParty));
    p.accept_split(&cx(&client(), 1, REJECT_AT + 2), 6000, 1).unwrap();
    assert_eq!(p.status, Status::Settled);
    assert_eq!(p.credits[&artist()].available, PRICE * 6 / 10 + BOND);
    assert_eq!(p.credits[&client()].available, PRICE * 4 / 10);
}

#[test]
fn accept_split_rejects_changed_proposal() {
    let mut p = disputed_piece();
    p.propose_split(&cx(&client(), 1, REJECT_AT + 1), 3000).unwrap();
    p.propose_split(&cx(&client(), 1, REJECT_AT + 2), 1000).unwrap(); // replaced, nonce 2
    assert_eq!(p.accept_split(&cx(&artist(), 1, REJECT_AT + 3), 3000, 1), Err(Error::ProposalChanged));
    assert_eq!(p.accept_split(&cx(&artist(), 1, REJECT_AT + 3), 3000, 2), Err(Error::ProposalChanged));
    assert_eq!(p.accept_split(&cx(&artist(), 1, REJECT_AT + 3), 1000, 1), Err(Error::ProposalChanged));
    p.accept_split(&cx(&artist(), 1, REJECT_AT + 3), 1000, 2).unwrap();
}

#[test]
fn accept_split_allowed_in_every_stage() {
    for now in [REJECT_AT + 1, NEG_END, ARB_END, FB_END + DAY] {
        let mut p = disputed_piece();
        p.propose_split(&cx(&artist(), 1, REJECT_AT + 1), 5000).unwrap();
        p.accept_split(&cx(&client(), 1, now), 5000, 1).unwrap();
        assert_eq!(p.status, Status::Settled, "now={now}");
    }
}

#[test]
fn arbitrator_only_in_its_stage() {
    let mut p = disputed_piece();
    assert_eq!(p.resolve(&cx(&arb(), 1, NEG_END - 1), 5000), Err(Error::WrongStage));
    assert_eq!(p.resolve(&cx(&fallback(), 1, NEG_END), 5000), Err(Error::NotArbitrator));
    assert_eq!(p.resolve(&cx(&client(), 1, NEG_END), 5000), Err(Error::NotArbitrator));
    assert_eq!(p.resolve(&cx(&arb(), 0, NEG_END), 5000), Err(Error::RequiresDeposit));
    assert_eq!(p.resolve(&cx(&arb(), 1, ARB_END), 5000), Err(Error::NotArbitrator), "arbitrator's stage over");
    p.resolve(&cx(&arb(), 1, ARB_END - 1), 5000).unwrap();
}

#[test]
fn fallback_only_after_21d() {
    let mut p = disputed_piece();
    assert_eq!(p.resolve(&cx(&fallback(), 1, ARB_END - 1), 5000), Err(Error::NotArbitrator));
    assert_eq!(p.resolve(&cx(&fallback(), 1, FB_END), 5000), Err(Error::WrongStage));
    p.resolve(&cx(&fallback(), 1, ARB_END), 2000).unwrap();
    assert_eq!(p.status, Status::Refunded);
}

#[test]
fn arbitrator_cannot_pay_third_party() {
    let mut p = disputed_piece();
    let before: Vec<AccountId> = p.credits.keys().cloned().collect();
    p.resolve(&cx(&arb(), 1, NEG_END), 7000).unwrap();
    for (who, s) in &p.credits {
        if s.available > 0 {
            assert!(who == &artist() || who == &client(), "{who} credited");
        }
    }
    assert_eq!(p.credits.keys().cloned().collect::<Vec<_>>(), before, "no new creditor");
    assert_eq!(p.resolve(&cx(&arb(), 1, NEG_END), 10_001), Err(Error::WrongStatus));
    let mut q = disputed_piece();
    assert_eq!(q.resolve(&cx(&arb(), 1, NEG_END), 10_001), Err(Error::InvalidBps));
}

#[test]
fn resolve_split_sums_to_escrow() {
    for bps in [0u16, 1, 3333, 4999, 5000, 9999, 10_000] {
        let mut p = disputed_piece();
        p.resolve(&cx(&arb(), 1, NEG_END), bps).unwrap();
        assert_eq!(p.escrow, 0);
        assert_eq!(p.released + p.refunded, p.funded, "bps {bps}");
        let paid: u128 = p.credits.values().map(|s| s.available).sum();
        assert_eq!(paid, PRICE + BOND);
        assert_eq!(p.bond, 0);
    }
}

#[test]
fn bond_to_winner() {
    for (bps, winner) in [(4999u16, client()), (5000, artist()), (5001, artist()), (0, client())] {
        let mut p = disputed_piece();
        let fx = p.resolve(&cx(&arb(), 1, NEG_END), bps).unwrap();
        assert!(fx.iter().any(|e| matches!(e, Effect::Event(SoulprintEvent::BondPaid { to, amount, .. }) if to == &winner && amount.0 == BOND)), "bps {bps}");
    }
}

#[test]
fn split_outcome_derived_from_share() {
    for (bps, status, owner) in [
        (0u16, Status::Refunded, artist()),
        (4999, Status::Refunded, artist()),
        (5000, Status::Settled, client()),
        (10_000, Status::Settled, client()),
    ] {
        let mut p = disputed_piece();
        p.resolve(&cx(&arb(), 1, NEG_END), bps).unwrap();
        assert_eq!((p.status, &p.owner), (status, &owner), "bps {bps}");
    }
}

#[test]
fn grant_active_only_if_artist_share_ge_half() {
    let mut p = disputed_piece();
    p.resolve(&cx(&arb(), 1, NEG_END), 4999).unwrap();
    assert!(!p.grant_active());
    let mut q = disputed_piece();
    q.resolve(&cx(&arb(), 1, NEG_END), 5000).unwrap();
    assert!(q.grant_active());
}

#[test]
fn timeout_outcome_matches_terms() {
    let mut p = disputed_piece();
    assert_eq!(p.timeout_resolve(&cx(&stranger(), 0, FB_END - 1)), Err(Error::WrongStage));
    p.timeout_resolve(&cx(&stranger(), 0, FB_END)).unwrap();
    assert_eq!(p.status, Status::Settled);
    let artist_share = PRICE * 7500 / 10_000;
    assert_eq!(p.credits[&artist()].available, artist_share + BOND);
    assert_eq!(p.credits[&client()].available, PRICE - artist_share);
}

#[test]
fn duplicate_submission_is_idempotent_or_rejected() {
    // Double accept_split: the second fails cleanly, state unchanged.
    let mut p = disputed_piece();
    p.propose_split(&cx(&artist(), 1, REJECT_AT + 1), 6000).unwrap();
    p.accept_split(&cx(&client(), 1, REJECT_AT + 2), 6000, 1).unwrap();
    let after = p.clone();
    assert!(p.accept_split(&cx(&client(), 1, REJECT_AT + 2), 6000, 1).is_err());
    assert_eq!(p, after);
    // Double fund: second rejected, escrow counted once.
    let mut q = funded(&cur_ft());
    let h = q.terms_hash.unwrap();
    assert_eq!(q.fund(&fx_ft(&client(), PRICE, FUND_AT), h, None), Err(Error::WrongStatus));
    assert_eq!(q.escrow, PRICE);
    // Double reject.
    let mut r = disputed_piece();
    assert_eq!(r.reject(&fx_ft(&client(), BOND, REJECT_AT)), Err(Error::WrongStatus));
    assert_eq!(r.bond, BOND);
}

#[test]
fn artist_cannot_be_client() {
    let mut t = terms(&cur_ft());
    t.client = Some(artist());
    let r = PieceCore::new(piece_id(), collection(), artist(), PieceKind::Commission(t), capture_pk(),
        TimeConfig::production(), cur_ft(), T0);
    assert_eq!(r.err(), Some(Error::Terms(TermsError::Client)));
    let mut t2 = terms(&cur_ft());
    t2.client = None;
    let mut p = PieceCore::new(piece_id(), collection(), artist(), PieceKind::Commission(t2), capture_pk(),
        TimeConfig::production(), cur_ft(), T0).unwrap();
    let h = p.terms_hash.unwrap();
    assert_eq!(p.fund(&fx_ft(&artist(), PRICE, FUND_AT), h, None), Err(Error::FunderNotAllowed));
}

#[test]
fn implicit_and_eth_accounts_supported() {
    let implicit = acc("0b3ff1e3a1b4c2b0f4d6e8a0c2e4f6a8b0d2e4f6a8c0e2a4c6e8a0b2d4f6a8c0");
    let eth = acc("0x32400084c286cf3e17e7b677ea9583e60a000324");
    for who in [implicit, eth] {
        let mut t = terms(&cur_ft());
        t.client = Some(who.clone());
        let mut p = PieceCore::new(piece_id(), collection(), artist(), PieceKind::Commission(t), capture_pk(),
            TimeConfig::production(), cur_ft(), T0).unwrap();
        let h = p.terms_hash.unwrap();
        p.fund(&fx_ft(&who, PRICE, FUND_AT), h, None).unwrap();
        p.deliver(&cx(&artist(), 1, DELIVER_AT), Bytes32([1; 32]), Bytes32([1; 32])).unwrap();
        p.reject(&fx_ft(&who, BOND, REJECT_AT)).unwrap();
        p.resolve(&cx(&arb(), 1, NEG_END), 0).unwrap();
        assert_eq!(p.credits[&who].available, PRICE + BOND);
    }
}

/// Plan 3 review minor 2: a refused delivery never earns "Commissioned and accepted", whatever
/// the split; acceptance does.
#[test]
fn no_badge_after_a_dispute_whatever_the_split() {
    for bps in [5000u16, 6000, 10_000] {
        let mut p = disputed_piece();
        p.resolve(&cx(&arb(), 1, NEG_END), bps).unwrap();
        assert_eq!(p.status, Status::Settled);
        assert!(!p.badge(), "arbitrator award {bps}");
        let mut q = disputed_piece();
        q.propose_split(&cx(&artist(), 1, REJECT_AT + 1), bps).unwrap();
        let n = q.split.as_ref().unwrap().nonce;
        q.accept_split(&cx(&client(), 1, REJECT_AT + 2), bps, n).unwrap();
        assert!(!q.badge(), "agreed split {bps}");
    }
    let accepted = settled_piece(&cur_ft());
    assert!(accepted.badge());
}
