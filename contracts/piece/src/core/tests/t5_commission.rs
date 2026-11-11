use super::*;
use proptest::prelude::*;

fn ft() -> CurrencyConfig { cur_ft() }

#[test]
fn fund_rejects_changed_terms_hash() {
    let mut p = new_piece(&ft());
    let r = p.fund(&fx_ft(&client(), PRICE, FUND_AT), Bytes32([0; 32]), None);
    assert_eq!(r, Err(Error::TermsChanged));
    assert_eq!(p, new_piece(&ft()));
}

#[test]
fn fund_requires_exact_amount() {
    for amt in [PRICE - 1, PRICE + 1, 0] {
        let mut p = new_piece(&ft());
        let h = p.terms_hash.unwrap();
        assert_eq!(p.fund(&fx_ft(&client(), amt, FUND_AT), h, None), Err(Error::WrongAmount));
    }
    let mut p = new_piece(&ft());
    let h = p.terms_hash.unwrap();
    // NEAR attached on an FT piece is the wrong currency.
    assert_eq!(p.fund(&cx(&client(), PRICE, FUND_AT), h, None), Err(Error::WrongCurrency));
}

#[test]
fn fund_rotates_owner_and_notifies_collection() {
    let mut p = new_piece(&ft());
    let h = p.terms_hash.unwrap();
    let fx = p.fund(&fx_ft(&client(), PRICE, FUND_AT), h, None).unwrap();
    assert_eq!(p.status, Status::InProgress);
    assert_eq!(p.owner, client());
    assert_eq!(p.rotation_seq, 1);
    assert_eq!((p.funded, p.escrow), (PRICE, PRICE));
    assert_eq!(p.funder, Some(client()));
    assert!(fx.contains(&Effect::NotifyCollection { seq: 1, owner: client() }));
    assert!(has_event(&fx, "funded") && has_event(&fx, "owner_changed"));
}

#[test]
fn fund_twice_rejected() {
    let mut p = funded(&ft());
    let h = p.terms_hash.unwrap();
    assert_eq!(p.fund(&fx_ft(&client(), PRICE, FUND_AT + 1), h, None), Err(Error::WrongStatus));
}

#[test]
fn fund_respects_named_client() {
    let mut p = new_piece(&ft());
    let h = p.terms_hash.unwrap();
    assert_eq!(p.fund(&fx_ft(&stranger(), PRICE, FUND_AT), h, None), Err(Error::NotNamedClient));
    // A third party may pay for the named client.
    let mut q = new_piece(&ft());
    q.fund(&fx_ft(&stranger(), PRICE, FUND_AT), h, Some(client())).unwrap();
    assert_eq!(q.owner, client());
    assert_eq!(q.funder, Some(stranger()));
}

#[test]
fn fund_open_commission_any_client() {
    let mut t = terms(&ft());
    t.client = None;
    let mut p = PieceCore::new(piece_id(), collection(), artist(), PieceKind::Commission(t), capture_pk(),
        TimeConfig::production(), ft(), T0).unwrap();
    let h = p.terms_hash.unwrap();
    p.fund(&fx_ft(&buyer(), PRICE, FUND_AT), h, None).unwrap();
    assert_eq!(p.owner, buyer());
}

#[test]
fn funder_not_artist_or_arbitrator() {
    let mut t = terms(&ft());
    t.client = None;
    for who in [artist(), arb(), fallback()] {
        let mut p = PieceCore::new(piece_id(), collection(), artist(), PieceKind::Commission(t.clone()), capture_pk(),
            TimeConfig::production(), ft(), T0).unwrap();
        let h = p.terms_hash.unwrap();
        assert_eq!(p.fund(&fx_ft(&who, PRICE, FUND_AT), h, None), Err(Error::FunderNotAllowed), "payer {who}");
        assert_eq!(p.fund(&fx_ft(&stranger(), PRICE, FUND_AT), h, Some(who.clone())), Err(Error::FunderNotAllowed), "beneficiary {who}");
    }
}

#[test]
fn fund_rejected_within_one_day_of_deadline() {
    let p0 = new_piece(&ft());
    let cutoff = p0.deadline - DAY;
    let mut p = p0.clone();
    let h = p.terms_hash.unwrap();
    assert_eq!(p.fund(&fx_ft(&client(), PRICE, cutoff), h, None), Err(Error::FundCutoff));
    let mut q = p0.clone();
    q.fund(&fx_ft(&client(), PRICE, cutoff - 1), h, None).unwrap();
}

#[test]
fn deliver_is_synchronous_and_beats_late_refund() {
    let mut p = funded(&ft());
    let grace_end = p.deadline + 2 * DAY;
    p.deliver(&cx(&artist(), 1, grace_end - 1), Bytes32([1; 32]), Bytes32([2; 32])).unwrap();
    assert_eq!(p.status, Status::Delivered);
    assert_eq!(p.delivered_at, Some(grace_end - 1));
    assert_eq!(p.claim_refund(&cx(&client(), 1, grace_end)), Err(Error::WrongStatus));
    // And the other order: at grace_end delivery is closed and refund is open.
    let mut q = funded(&ft());
    assert_eq!(q.deliver(&cx(&artist(), 1, grace_end), Bytes32([1; 32]), Bytes32([2; 32])), Err(Error::DeadlinePassed));
    q.claim_refund(&cx(&client(), 1, grace_end)).unwrap();
}

#[test]
fn deliver_only_artist_with_yocto() {
    let mut p = funded(&ft());
    assert_eq!(p.deliver(&cx(&client(), 1, DELIVER_AT), Bytes32([1; 32]), Bytes32([2; 32])), Err(Error::NotArtist));
    assert_eq!(p.deliver(&cx(&artist(), 0, DELIVER_AT), Bytes32([1; 32]), Bytes32([2; 32])), Err(Error::RequiresDeposit));
}

#[test]
fn request_changes_limited_to_rounds() {
    let mut p = delivered_piece(&ft());
    let mut now = DELIVER_AT + 1;
    for round in 1..=2u8 {
        p.request_changes(&cx(&client(), 1, now)).unwrap();
        assert_eq!(p.status, Status::InProgress);
        assert_eq!(p.revisions_used, round);
        now += SEC;
        p.deliver(&cx(&artist(), 1, now), Bytes32([round; 32]), Bytes32([round; 32])).unwrap();
        now += SEC;
    }
    assert_eq!(p.request_changes(&cx(&client(), 1, now)), Err(Error::NoRevisionsLeft));
}

#[test]
fn request_changes_extends_deadline() {
    let mut p = funded(&ft());
    let late = p.deadline + DAY; // within grace
    p.deliver(&cx(&artist(), 1, late), Bytes32([1; 32]), Bytes32([1; 32])).unwrap();
    let fx = p.request_changes(&cx(&client(), 1, late + SEC)).unwrap();
    assert_eq!(p.deadline, late + SEC + 3 * DAY);
    assert!(has_event(&fx, "changes_requested"));
    // An early request keeps the original deadline.
    let mut q = delivered_piece(&ft());
    let d0 = q.deadline;
    q.request_changes(&cx(&client(), 1, DELIVER_AT + 1)).unwrap();
    assert_eq!(q.deadline, d0);
}

#[test]
fn request_changes_then_claim_refund_fails() {
    let mut p = funded(&ft());
    let late = p.deadline + DAY;
    p.deliver(&cx(&artist(), 1, late), Bytes32([1; 32]), Bytes32([1; 32])).unwrap();
    p.request_changes(&cx(&client(), 1, late + SEC)).unwrap();
    // Old grace end has passed, but the extended deadline protects the artist.
    let old_grace_end = p.terms.as_ref().unwrap().deadline_ns.0 + 2 * DAY;
    assert_eq!(p.claim_refund(&cx(&client(), 1, old_grace_end + SEC)), Err(Error::RefundNotYet));
}

#[test]
fn milestones_release_in_order_and_sum_to_funded() {
    let mut p = funded(&ft());
    assert_eq!(p.release_milestone(&cx(&client(), 1, FUND_AT + 1), 1), Err(Error::MilestoneOrder));
    assert_eq!(p.release_milestone(&cx(&artist(), 1, FUND_AT + 1), 0), Err(Error::NotOwner));
    p.release_milestone(&cx(&client(), 1, FUND_AT + 1), 0).unwrap();
    assert_eq!(p.released, 30_000_000);
    assert_eq!(p.credits[&artist()].available, 30_000_000);
    p.release_milestone(&cx(&client(), 1, FUND_AT + 2), 1).unwrap();
    assert_eq!((p.released, p.escrow), (PRICE, 0));
    assert_eq!(p.release_milestone(&cx(&client(), 1, FUND_AT + 3), 2), Err(Error::NoMilestonesLeft));
    assert_eq!(p.status, Status::InProgress);
}

fn bps_vec() -> impl Strategy<Value = Vec<u16>> {
    prop::collection::vec(1u16..10_000, 0..4).prop_map(|mut cuts| {
        cuts.sort();
        cuts.dedup();
        let mut out = vec![];
        let mut prev = 0u16;
        for c in cuts {
            out.push(c - prev);
            prev = c;
        }
        out.push(10_000 - prev);
        out
    })
}

proptest! {
    #[test]
    fn rounding_never_leaves_dust(price in 1u128..=u128::MAX / 10_001, bps in bps_vec(), accept_after in 0usize..5) {
        let mut cur = ft();
        cur.min_price = 1u128.into();
        let mut t = terms(&cur);
        t.price = price.into();
        t.milestones = bps.iter().map(|b| Milestone { bps: *b }).collect();
        let mut p = PieceCore::new(piece_id(), collection(), artist(), PieceKind::Commission(t), capture_pk(),
            TimeConfig::production(), cur.clone(), T0).unwrap();
        let h = p.terms_hash.unwrap();
        p.fund(&fx_ft(&client(), price, FUND_AT), h, None).unwrap();
        let n = bps.len().min(accept_after);
        for i in 0..n {
            p.release_milestone(&cx(&client(), 1, FUND_AT + 1), i as u8).unwrap();
            prop_assert_eq!(p.released + p.refunded + p.escrow, p.funded);
        }
        p.deliver(&cx(&artist(), 1, DELIVER_AT), Bytes32([1; 32]), Bytes32([1; 32])).unwrap();
        p.accept(&cx(&client(), 1, DELIVER_AT + 1)).unwrap();
        prop_assert_eq!(p.escrow, 0);
        prop_assert_eq!(p.released, price);
        prop_assert_eq!(p.credits[&artist()].available, price);
    }
}

#[test]
fn accept_releases_remainder_and_settles() {
    let mut p = funded(&ft());
    p.release_milestone(&cx(&client(), 1, FUND_AT + 1), 0).unwrap();
    p.deliver(&cx(&artist(), 1, DELIVER_AT), Bytes32([1; 32]), Bytes32([1; 32])).unwrap();
    let fx = p.accept(&cx(&client(), 1, DELIVER_AT + 1)).unwrap();
    assert_eq!(p.status, Status::Settled);
    assert_eq!((p.escrow, p.released), (0, PRICE));
    assert_eq!(p.credits[&artist()].available, PRICE);
    assert!(p.commissioned);
    assert_eq!(p.owner, client(), "client keeps the token");
    assert!(has_event(&fx, "settled"));
}

#[test]
fn settle_by_anyone_after_review_lapse() {
    let mut p = delivered_piece(&ft());
    let end = DELIVER_AT + 7 * DAY;
    assert_eq!(p.settle(&cx(&stranger(), 0, end - 1)), Err(Error::ReviewOpen));
    p.settle(&cx(&stranger(), 0, end)).unwrap();
    assert_eq!(p.status, Status::Settled);
    assert_eq!(p.credits[&artist()].available, PRICE);
}

#[test]
fn accept_after_lapse_is_rejected_and_reverts() {
    let mut p = delivered_piece(&ft());
    let before = p.clone();
    assert_eq!(p.accept(&cx(&client(), 1, DELIVER_AT + 7 * DAY)), Err(Error::WrongStatus));
    assert_eq!(p, before, "rejected call leaves state untouched (A42)");
}

#[test]
fn refund_voids_grant_and_returns_token_to_artist() {
    let mut p = funded(&ft());
    p.release_milestone(&cx(&client(), 1, FUND_AT + 1), 0).unwrap();
    let end = p.deadline + 2 * DAY;
    assert_eq!(p.claim_refund(&cx(&client(), 1, end - 1)), Err(Error::RefundNotYet));
    assert_eq!(p.claim_refund(&cx(&artist(), 1, end)), Err(Error::NotOwner));
    let fx = p.claim_refund(&cx(&client(), 1, end)).unwrap();
    assert_eq!(p.status, Status::Refunded);
    assert_eq!(p.owner, artist());
    assert_eq!(p.rotation_seq, 2);
    assert_eq!(p.credits[&client()].available, 70_000_000);
    assert_eq!(p.credits[&artist()].available, 30_000_000, "released milestones stay with the artist");
    assert_eq!((p.escrow, p.refunded), (0, 70_000_000));
    assert!(!p.grant_active());
    assert!(fx.contains(&Effect::NotifyCollection { seq: 2, owner: artist() }));
}

#[test]
fn mutual_cancel_outcome() {
    let mut p = funded(&ft());
    p.release_milestone(&cx(&client(), 1, FUND_AT + 1), 0).unwrap();
    p.consent_mutual_cancel(&cx(&artist(), 1, FUND_AT + 2)).unwrap();
    assert_eq!(p.status, Status::InProgress);
    assert_eq!(p.consent_mutual_cancel(&cx(&artist(), 1, FUND_AT + 2)), Err(Error::AlreadyConsented));
    p.consent_mutual_cancel(&cx(&client(), 1, FUND_AT + 3)).unwrap();
    assert_eq!(p.status, Status::Refunded);
    assert_eq!(p.owner, artist());
    assert_eq!(p.credits[&client()].available, 70_000_000);
    assert_eq!(p.credits[&artist()].available, 30_000_000);
    assert!(!p.grant_active());
}

#[test]
fn mutual_cancel_consent_cleared_on_rotation() {
    let mut p = funded(&ft());
    p.consent_mutual_cancel(&cx(&client(), 1, FUND_AT + 2)).unwrap();
    // Any owner change (here simulated directly) invalidates prior consents.
    let mut fx = vec![];
    p.set_owner(&mut fx, buyer(), OwnerChangeCause::Transfer, false);
    assert_eq!(p.consents, Consents::default());
    p.consent_mutual_cancel(&cx(&artist(), 1, FUND_AT + 3)).unwrap();
    assert_eq!(p.status, Status::InProgress, "old owner's consent must not count");
    // A consent recorded at an old seq does not count either.
    p.consents.cancel_owner = Some(0);
    p.consent_mutual_cancel(&cx(&artist(), 1, FUND_AT + 4)).ok();
    assert_eq!(p.status, Status::InProgress);
}

#[test]
fn extend_deadline_needs_both() {
    let mut p = funded(&ft());
    let nd = p.deadline + 5 * DAY;
    p.consent_extend(&cx(&artist(), 1, FUND_AT + 1), nd).unwrap();
    assert_eq!(p.deadline, T0 + 30 * DAY);
    p.consent_extend(&cx(&client(), 1, FUND_AT + 2), nd + 1).unwrap();
    assert_eq!(p.deadline, T0 + 30 * DAY, "different dates do not match");
    let fx = p.consent_extend(&cx(&client(), 1, FUND_AT + 3), nd).unwrap();
    assert_eq!(p.deadline, nd);
    assert!(has_event(&fx, "deadline_extended"));
    assert_eq!(p.consent_extend(&cx(&client(), 1, FUND_AT + 4), nd - 10 * DAY), Err(Error::InvalidDeadline));
}

#[test]
fn cancel_only_offered_by_artist() {
    let mut p = new_piece(&ft());
    assert_eq!(p.cancel(&cx(&client(), 1, T0)), Err(Error::NotArtist));
    p.cancel(&cx(&artist(), 1, T0)).unwrap();
    assert_eq!(p.status, Status::Cancelled);
    let mut q = funded(&ft());
    assert_eq!(q.cancel(&cx(&artist(), 1, FUND_AT + 1)), Err(Error::WrongStatus));
}

fn standalone() -> PieceCore {
    let st = StandaloneTerms {
        currency: Currency::Near, royalty_bps: 500,
        grant: Grant { kind: GrantType::Personal, attribution: true, transferable: true },
        licence_text_hash: Bytes32([0; 32]),
    };
    PieceCore::new(piece_id(), collection(), artist(), PieceKind::Standalone(st), capture_pk(),
        TimeConfig::production(), cur_near(), T0).unwrap()
}

#[test]
fn standalone_settles_without_escrow() {
    let mut p = standalone();
    assert_eq!(p.settle_standalone(&cx(&client(), 1, T0 + 1), Bytes32([1; 32]), Bytes32([2; 32])), Err(Error::NotArtist));
    p.settle_standalone(&cx(&artist(), 1, T0 + 1), Bytes32([1; 32]), Bytes32([2; 32])).unwrap();
    assert_eq!(p.status, Status::Settled);
    assert_eq!(p.owner, artist());
    assert_eq!((p.funded, p.escrow), (0, 0));
    assert_eq!(p.final_file_hash, Some(Bytes32([1; 32])));
    assert!(!p.commissioned);
    // Commission pieces cannot use the standalone path.
    let mut c = new_piece(&ft());
    assert_eq!(c.settle_standalone(&cx(&artist(), 1, T0 + 1), Bytes32([1; 32]), Bytes32([2; 32])), Err(Error::WrongStatus));
}

#[test]
fn reopen_as_standalone_after_refund() {
    let mut p = funded(&ft());
    assert_eq!(p.reopen_as_standalone(&cx(&artist(), 1, FUND_AT + 1)), Err(Error::NotStandaloneEligible));
    let end = p.deadline + 2 * DAY;
    p.claim_refund(&cx(&client(), 1, end)).unwrap();
    assert_eq!(p.reopen_as_standalone(&cx(&client(), 1, end + 1)), Err(Error::NotArtist));
    let fx = p.reopen_as_standalone(&cx(&artist(), 1, end + 1)).unwrap();
    assert!(has_event(&fx, "reopened_standalone"));
    assert_eq!((p.mode, p.status), (Mode::Standalone, Status::Offered));
    p.settle_standalone(&cx(&artist(), 1, end + 2), Bytes32([1; 32]), Bytes32([2; 32])).unwrap();
    assert_eq!(p.status, Status::Settled);
    assert!(!p.commissioned, "no Commissioned badge after a refund");
    assert_eq!(p.credits[&client()].available, PRICE, "client refund untouched");
}

#[test]
fn near_piece_fund_by_attached_deposit() {
    let p = funded(&cur_near());
    assert_eq!(p.escrow, 10u128.pow(25));
}
