use super::*;

fn transfer_of(fx: &Effects) -> (AccountId, u128, SlotId) {
    fx.iter()
        .find_map(|e| match e {
            Effect::TransferFt { to, amount, slot, token } => {
                assert_eq!(token, &usdc());
                Some((to.clone(), *amount, slot.clone()))
            }
            Effect::TransferNear { to, amount, slot } => Some((to.clone(), *amount, slot.clone())),
            _ => None,
        })
        .expect("no transfer effect")
}

const NOW: u64 = SETTLED_AT + 1;

#[test]
fn claim_pays_predecessor_only() {
    let mut p = settled_piece(&cur_ft());
    assert_eq!(p.claim(&cx(&stranger(), 0, NOW)), Err(Error::NothingToClaim));
    let fx = p.claim(&cx(&artist(), 0, NOW)).unwrap();
    assert_eq!(transfer_of(&fx), (artist(), PRICE, SlotId::Credit(artist())));
    let s = &p.credits[&artist()];
    assert_eq!((s.available, s.in_flight), (0, PRICE));
    assert!(has_event(&fx, "claim"));
}

#[test]
fn claim_on_near_piece_uses_near_transfer() {
    let mut p = settled_piece(&cur_near());
    let fx = p.claim(&cx(&artist(), 0, NOW)).unwrap();
    assert!(matches!(fx.iter().find(|e| !matches!(e, Effect::Event(_))), Some(Effect::TransferNear { .. })));
}

#[test]
fn claim_requires_min_gas() {
    let mut p = settled_piece(&cur_ft());
    let mut c = cx(&artist(), 0, NOW);
    c.prepaid_gas = common::gas::MIN_CLAIM_FT.as_gas() - 1;
    assert_eq!(p.claim(&c), Err(Error::NotEnoughGas));
}

#[test]
fn claim_to_requires_yocto_and_rejects_self_piece() {
    let mut p = settled_piece(&cur_ft());
    assert_eq!(p.claim_to(&cx(&artist(), 0, NOW), buyer()), Err(Error::RequiresDeposit));
    assert_eq!(p.claim_to(&cx(&artist(), 1, NOW), piece_id()), Err(Error::InvalidRecipient));
    let fx = p.claim_to(&cx(&artist(), 1, NOW), buyer()).unwrap();
    assert_eq!(transfer_of(&fx), (buyer(), PRICE, SlotId::Credit(artist())));
}

#[test]
fn claim_to_self_piece_rejected() {
    let mut p = settled_piece(&cur_ft());
    assert_eq!(p.claim_to(&cx(&artist(), 1, NOW), piece_id()), Err(Error::InvalidRecipient));
}

#[test]
fn failed_claim_restores_creditor_not_pool() {
    let mut p = settled_piece(&cur_ft());
    p.holder_pool = 5_000;
    p.claim(&cx(&artist(), 0, NOW)).unwrap();
    let fx = p.on_transfer_result(SlotId::Credit(artist()), PRICE, false);
    let s = &p.credits[&artist()];
    assert_eq!((s.available, s.in_flight), (PRICE, 0));
    assert_eq!(p.holder_pool, 5_000);
    assert!(has_event(&fx, "claim_restored"));
}

#[test]
fn successful_claim_clears_in_flight() {
    let mut p = settled_piece(&cur_ft());
    p.claim(&cx(&artist(), 0, NOW)).unwrap();
    let fx = p.on_transfer_result(SlotId::Credit(artist()), PRICE, true);
    assert!(fx.is_empty());
    let s = &p.credits[&artist()];
    assert_eq!((s.available, s.in_flight), (0, 0));
    assert!(s.prefunded, "prefunded slots stay");
}

#[test]
fn second_claim_while_in_flight_rejected() {
    let mut p = settled_piece(&cur_ft());
    p.claim(&cx(&artist(), 0, NOW)).unwrap();
    p.credits.get_mut(&artist()).unwrap().available = 10; // e.g. a royalty arrives meanwhile
    assert_eq!(p.claim(&cx(&artist(), 0, NOW)), Err(Error::ClaimInFlight));
    assert_eq!(p.claim_to(&cx(&artist(), 1, NOW), buyer()), Err(Error::ClaimInFlight));
}

#[test]
fn restore_never_grows_storage() {
    let mut p = settled_piece(&cur_ft());
    p.claim(&cx(&artist(), 0, NOW)).unwrap();
    let slots = p.credits.len();
    p.on_transfer_result(SlotId::Credit(artist()), PRICE, false);
    assert_eq!(p.credits.len(), slots);
    // A result for an unknown slot is ignored, never creates a slot.
    let fx = p.on_transfer_result(SlotId::Credit(stranger()), 7, false);
    assert!(fx.is_empty());
    assert_eq!(p.credits.len(), slots);
}

#[test]
fn non_prefunded_slot_removed_after_paid() {
    let mut p = settled_piece(&cur_ft());
    p.credit(&buyer(), 50);
    p.claim(&cx(&buyer(), 0, NOW)).unwrap();
    p.on_transfer_result(SlotId::Credit(buyer()), 50, true);
    assert!(!p.credits.contains_key(&buyer()));
}

#[test]
fn withdraw_zero_pool_rejected() {
    let mut p = settled_piece(&cur_ft());
    assert_eq!(p.withdraw(&cx(&client(), 1, NOW)), Err(Error::PoolEmpty));
}

#[test]
fn withdraw_moves_pool_to_owner_and_claims() {
    let mut p = settled_piece(&cur_ft());
    p.holder_pool = 9_000;
    assert_eq!(p.withdraw(&cx(&artist(), 1, NOW)), Err(Error::NotOwner));
    assert_eq!(p.withdraw(&cx(&client(), 0, NOW)), Err(Error::RequiresDeposit));
    let fx = p.withdraw(&cx(&client(), 1, NOW)).unwrap();
    assert_eq!(p.holder_pool, 0);
    assert_eq!(transfer_of(&fx), (client(), 9_000, SlotId::Credit(client())));
    assert!(has_event(&fx, "withdraw"));
    // Failure lands with the owner's credit, never back in the pool (T3).
    p.on_transfer_result(SlotId::Credit(client()), 9_000, false);
    assert_eq!(p.holder_pool, 0);
    assert_eq!(p.credits[&client()].available, 9_000);
}

#[test]
fn withdraw_blocked_while_listed() {
    let mut p = settled_piece(&cur_ft());
    p.holder_pool = 9_000;
    p.listing = Some(Listing { seller: client(), price: PRICE, nonce: 1, reserved_for: None });
    assert_eq!(p.withdraw(&cx(&client(), 1, NOW)), Err(Error::Listed));
}

#[test]
fn withdraw_blocked_while_owner_claim_in_flight() {
    let mut p = settled_piece(&cur_ft());
    p.credit(&client(), 5);
    p.claim(&cx(&client(), 0, NOW)).unwrap();
    p.holder_pool = 9_000;
    assert_eq!(p.withdraw(&cx(&client(), 1, NOW)), Err(Error::ClaimInFlight));
}

#[test]
fn withdraw_requires_settled() {
    let mut p = funded(&cur_ft());
    p.holder_pool = 1;
    assert_eq!(p.withdraw(&cx(&client(), 1, NOW)), Err(Error::WrongStatus));
}
