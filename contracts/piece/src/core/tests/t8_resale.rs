use super::*;

const NOW: u64 = SETTLED_AT + 10;

fn buy(p: &mut PieceCore, who: &AccountId, amount: u128, nonce: u64, max: u128, pool_min: u128) -> Res {
    p.buy(&fx_ft(who, amount, NOW), nonce, max, pool_min)
}

#[test]
fn list_blocked_before_settled() {
    let mut p = funded(&cur_ft());
    assert_eq!(p.list(&cx(&client(), 1, FUND_AT + 1), LIST_PRICE, None), Err(Error::WrongStatus));
    let mut q = delivered_piece(&cur_ft());
    assert_eq!(q.list(&cx(&client(), 1, DELIVER_AT + 1), LIST_PRICE, None), Err(Error::WrongStatus));
}

#[test]
fn list_requires_owner_and_min_price() {
    let mut p = settled_piece(&cur_ft());
    assert_eq!(p.list(&cx(&artist(), 1, NOW), LIST_PRICE, None), Err(Error::NotOwner));
    assert_eq!(p.list(&cx(&client(), 0, NOW), LIST_PRICE, None), Err(Error::RequiresDeposit));
    assert_eq!(p.list(&cx(&client(), 1, NOW), 99_999, None), Err(Error::PriceTooLow));
    let fx = p.list(&cx(&client(), 1, NOW), 100_000, None).unwrap();
    assert!(has_event(&fx, "listed"));
}

#[test]
fn listing_nonce_never_reused() {
    let mut p = listed_piece();
    assert_eq!(p.listing.as_ref().unwrap().nonce, 1);
    p.delist(&cx(&client(), 1, NOW)).unwrap();
    assert_eq!(p.delist(&cx(&client(), 1, NOW)), Err(Error::NotListed));
    p.list(&cx(&client(), 1, NOW), LIST_PRICE, None).unwrap();
    assert_eq!(p.listing.as_ref().unwrap().nonce, 2);
    p.list(&cx(&client(), 1, NOW), LIST_PRICE + 1, None).unwrap();
    assert_eq!(p.listing.as_ref().unwrap().nonce, 3);
}

#[test]
fn buy_rejects_changed_nonce() {
    let mut p = listed_piece();
    p.list(&cx(&client(), 1, NOW), LIST_PRICE * 2, None).unwrap(); // relist higher: nonce 2
    assert_eq!(buy(&mut p, &buyer(), LIST_PRICE, 1, LIST_PRICE, 0), Err(Error::ListingChanged));
    assert_eq!(buy(&mut p, &buyer(), LIST_PRICE * 2, 2, LIST_PRICE, 0), Err(Error::PriceTooHigh));
}

#[test]
fn buy_fails_if_pool_below_expected() {
    let mut p = listed_piece();
    p.holder_pool = 1_000;
    assert_eq!(buy(&mut p, &buyer(), LIST_PRICE, 1, LIST_PRICE, 1_001), Err(Error::PoolBelowExpected));
    buy(&mut p, &buyer(), LIST_PRICE, 1, LIST_PRICE, 1_000).unwrap();
}

#[test]
fn buy_by_seller_rejected() {
    let mut p = listed_piece();
    assert_eq!(buy(&mut p, &client(), LIST_PRICE, 1, LIST_PRICE, 0), Err(Error::BuyerIsSeller));
}

#[test]
fn buy_requires_exact_amount() {
    let mut p = listed_piece();
    for a in [LIST_PRICE - 1, LIST_PRICE + 1] {
        assert_eq!(buy(&mut p, &buyer(), a, 1, LIST_PRICE * 2, 0), Err(Error::WrongAmount));
    }
    assert_eq!(p.buy(&cx(&buyer(), LIST_PRICE, NOW), 1, LIST_PRICE, 0), Err(Error::WrongCurrency));
}

#[test]
fn royalty_and_seller_credit_sum_to_price() {
    let mut p = listed_piece();
    let artist_before = p.credits[&artist()].available;
    let fx = buy(&mut p, &buyer(), LIST_PRICE, 1, LIST_PRICE, 0).unwrap();
    let royalty = LIST_PRICE * 500 / 10_000;
    assert_eq!(p.credits[&artist()].available - artist_before, royalty);
    assert_eq!(p.credits[&client()].available, LIST_PRICE - royalty);
    assert_eq!(p.owner, buyer());
    assert_eq!(p.rotation_seq, 2);
    assert!(p.listing.is_none());
    assert!(fx.contains(&Effect::NotifyCollection { seq: 2, owner: buyer() }));
    assert!(has_event(&fx, "sold") && has_event(&fx, "owner_changed"));
}

#[test]
fn reserved_listing_only_for_reserved_buyer() {
    let mut p = settled_piece(&cur_ft());
    p.list(&cx(&client(), 1, NOW), LIST_PRICE, Some(buyer2())).unwrap();
    assert_eq!(buy(&mut p, &buyer(), LIST_PRICE, 1, LIST_PRICE, 0), Err(Error::Reserved));
    buy(&mut p, &buyer2(), LIST_PRICE, 1, LIST_PRICE, 0).unwrap();
}

#[test]
fn income_before_and_after_buy_goes_to_buyer() {
    let mut p = listed_piece();
    p.pay_income(&fx_ft(&stranger(), 40_000, NOW)).unwrap();
    // Seller cannot drain the pool while listed (T1).
    assert_eq!(p.withdraw(&cx(&client(), 1, NOW)), Err(Error::Listed));
    buy(&mut p, &buyer(), LIST_PRICE, 1, LIST_PRICE, 40_000).unwrap();
    p.pay_income(&fx_ft(&stranger(), 60_000, NOW + 1)).unwrap();
    assert_eq!(p.holder_pool, 100_000);
    assert_eq!(p.withdraw(&cx(&client(), 1, NOW + 2)), Err(Error::NotOwner));
    p.withdraw(&cx(&buyer(), 1, NOW + 2)).unwrap();
    assert_eq!(p.credits[&buyer()].in_flight, 100_000);
    // Seller's credits are exactly the sale proceeds (I5).
    assert_eq!(p.credits[&client()].available, LIST_PRICE - LIST_PRICE * 500 / 10_000);
}

#[test]
fn pay_income_rules() {
    let mut p = settled_piece(&cur_ft());
    assert_eq!(p.pay_income(&fx_ft(&stranger(), 9_999, NOW)), Err(Error::IncomeTooSmall));
    let fx = p.pay_income(&fx_ft(&stranger(), 10_000, NOW)).unwrap();
    assert!(has_event(&fx, "income"));
    let mut q = funded(&cur_ft());
    assert_eq!(q.pay_income(&fx_ft(&stranger(), 10_000, FUND_AT + 1)), Err(Error::WrongStatus));
}

#[test]
fn pay_income_rejected_on_personal_grant() {
    let mut t = terms(&cur_ft());
    t.grant.kind = GrantType::Personal;
    let mut p = PieceCore::new(piece_id(), collection(), artist(), PieceKind::Commission(t), capture_pk(),
        TimeConfig::production(), cur_ft(), T0).unwrap();
    let h = p.terms_hash.unwrap();
    p.fund(&fx_ft(&client(), PRICE, FUND_AT), h, None).unwrap();
    p.deliver(&cx(&artist(), 1, DELIVER_AT), Bytes32([1; 32]), Bytes32([1; 32])).unwrap();
    p.accept(&cx(&client(), 1, DELIVER_AT + 1)).unwrap();
    assert_eq!(p.pay_income(&fx_ft(&stranger(), 10_000, NOW)), Err(Error::IncomeNotLicensed));
}

#[test]
fn duplicate_buy_rejected() {
    let mut p = listed_piece();
    buy(&mut p, &buyer(), LIST_PRICE, 1, LIST_PRICE, 0).unwrap();
    let after = p.clone();
    assert_eq!(buy(&mut p, &buyer(), LIST_PRICE, 1, LIST_PRICE, 0), Err(Error::NotListed));
    assert_eq!(p, after);
}

#[test]
fn buy_clears_consents_and_old_owner_cannot_act() {
    let mut p = listed_piece();
    buy(&mut p, &buyer(), LIST_PRICE, 1, LIST_PRICE, 0).unwrap();
    assert_eq!(p.list(&cx(&client(), 1, NOW), LIST_PRICE, None), Err(Error::NotOwner));
    assert_eq!(p.consents, Consents::default());
}

#[test]
fn standalone_resale_royalty_to_artist() {
    let st = StandaloneTerms {
        currency: Currency::Ft(usdc()), royalty_bps: 1000,
        grant: Grant { kind: GrantType::CommercialNonExclusive, attribution: true, transferable: true },
        licence_text_hash: Bytes32([0; 32]),
    };
    let mut p = PieceCore::new(piece_id(), collection(), artist(), PieceKind::Standalone(st), capture_pk(),
        TimeConfig::production(), cur_ft(), T0).unwrap();
    p.settle_standalone(&cx(&artist(), 1, T0 + 1), Bytes32([1; 32]), Bytes32([1; 32])).unwrap();
    p.list(&cx(&artist(), 1, T0 + 2), LIST_PRICE, None).unwrap();
    p.buy(&fx_ft(&buyer(), LIST_PRICE, T0 + 3), 1, LIST_PRICE, 0).unwrap();
    assert_eq!(p.credits[&artist()].available, LIST_PRICE, "artist is seller and royalty holder");
    assert_eq!(p.owner, buyer());
}
