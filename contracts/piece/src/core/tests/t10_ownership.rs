use super::*;

const NOW: u64 = SETTLED_AT + 100;
const EXPIRY: u64 = DAY;

fn coll(now: u64) -> Ctx { cx(&collection(), 0, now) }

fn pending_piece() -> PieceCore {
    let mut p = settled_piece(&cur_ft());
    p.holder_pool = 50_000;
    p.rotate_owner(&coll(NOW), client(), buyer(), true).unwrap();
    p
}

#[test]
fn transfer_blocked_before_settled() {
    for mut p in [new_piece(&cur_ft()), funded(&cur_ft()), delivered_piece(&cur_ft())] {
        let owner = p.owner.clone();
        let now = DELIVER_AT + 1;
        assert_eq!(p.rotate_owner(&coll(now), owner, buyer(), false), Err(Error::WrongStatus));
    }
}

#[test]
fn transfer_blocked_while_disputed() {
    let mut p = disputed_piece();
    assert_eq!(p.rotate_owner(&coll(REJECT_AT + 1), client(), buyer(), false), Err(Error::WrongStatus));
}

#[test]
fn rotate_only_from_collection() {
    let mut p = settled_piece(&cur_ft());
    assert_eq!(p.rotate_owner(&cx(&client(), 1, NOW), client(), buyer(), false), Err(Error::NotCollection));
    let fx = p.rotate_owner(&coll(NOW), client(), buyer(), false).unwrap();
    assert_eq!(p.owner, buyer());
    assert_eq!(p.rotation_seq, 2);
    assert!(has_event(&fx, "owner_changed"));
    assert!(!fx.iter().any(|e| matches!(e, Effect::NotifyCollection { .. })), "collection records via its own callback");
}

#[test]
fn rotate_requires_sender_owner() {
    let mut p = settled_piece(&cur_ft());
    assert_eq!(p.rotate_owner(&coll(NOW), artist(), buyer(), false), Err(Error::NotOwner));
}

#[test]
fn rotate_rejects_self_piece_collection_receiver() {
    let mut p = settled_piece(&cur_ft());
    for r in [client(), piece_id(), collection()] {
        assert_eq!(p.rotate_owner(&coll(NOW), client(), r, false), Err(Error::InvalidReceiver));
    }
}

#[test]
fn rotate_blocked_while_listed() {
    let mut p = listed_piece();
    assert_eq!(p.rotate_owner(&coll(NOW), client(), buyer(), false), Err(Error::Listed));
}

#[test]
fn rotate_rejected_while_pending() {
    let mut p = pending_piece();
    assert_eq!(p.rotate_owner(&coll(NOW + 1), buyer(), buyer2(), false), Err(Error::TransferPending));
}

#[test]
fn transfer_call_receiver_cannot_withdraw_list_accept() {
    let mut p = pending_piece();
    assert_eq!(p.owner, buyer());
    let b = |n| cx(&buyer(), 1, NOW + n);
    assert_eq!(p.withdraw(&b(1)), Err(Error::TransferPending));
    assert_eq!(p.list(&b(1), LIST_PRICE, None), Err(Error::TransferPending));
    assert_eq!(p.delist(&b(1)), Err(Error::TransferPending));
    p.pending_addendum = Some(Addendum { grant: Grant { kind: GrantType::FullAssignment, ..p.grant }, text_hash: Bytes32([1; 32]) });
    assert_eq!(p.accept_addendum(&b(1), Bytes32([1; 32])), Err(Error::TransferPending));
    assert_eq!(p.buy(&fx_ft(&buyer2(), LIST_PRICE, NOW + 1), 1, LIST_PRICE, 0), Err(Error::TransferPending));
    assert_eq!(p.holder_pool, 50_000);
}

#[test]
fn transfer_call_revert_cannot_be_blocked() {
    let mut p = pending_piece();
    // Whatever the receiver tried, the revert lands.
    let _ = p.withdraw(&cx(&buyer(), 1, NOW + 1));
    let _ = p.list(&cx(&buyer(), 1, NOW + 1), LIST_PRICE, None);
    let fx = p.resolve_transfer(&coll(NOW + 2), true).unwrap();
    assert_eq!(p.owner, client());
    assert_eq!(p.rotation_seq, 3);
    assert!(p.transfer_pending.is_none());
    assert_eq!(p.holder_pool, 50_000);
    assert!(has_event(&fx, "transfer_reverted"));
    p.withdraw(&cx(&client(), 1, NOW + 3)).unwrap();
}

#[test]
fn transfer_call_accepted_keeps_receiver() {
    let mut p = pending_piece();
    p.resolve_transfer(&coll(NOW + 2), false).unwrap();
    assert_eq!(p.owner, buyer());
    assert_eq!(p.rotation_seq, 2);
    assert!(p.transfer_pending.is_none());
    p.withdraw(&cx(&buyer(), 1, NOW + 3)).unwrap();
}

#[test]
fn resolve_transfer_only_collection() {
    let mut p = pending_piece();
    assert_eq!(p.resolve_transfer(&cx(&buyer(), 0, NOW + 2), false), Err(Error::NotCollection));
}

#[test]
fn transfer_pending_expires_and_reverts() {
    let mut p = pending_piece();
    assert_eq!(p.expire_pending(&cx(&stranger(), 0, NOW + EXPIRY - 1)), Err(Error::PendingNotExpired));
    let fx = p.expire_pending(&cx(&stranger(), 0, NOW + EXPIRY)).unwrap();
    assert_eq!(p.owner, client());
    assert_eq!(p.rotation_seq, 3);
    assert!(fx.contains(&Effect::NotifyCollection { seq: 3, owner: client() }));
    assert_eq!(p.expire_pending(&cx(&stranger(), 0, NOW + EXPIRY)), Err(Error::NoTransferPending));
}

#[test]
fn late_resolve_after_expiry_is_noop() {
    let mut p = pending_piece();
    p.expire_pending(&cx(&stranger(), 0, NOW + EXPIRY)).unwrap();
    let before = p.clone();
    let fx = p.resolve_transfer(&coll(NOW + EXPIRY + 1), false).unwrap();
    assert!(fx.is_empty());
    assert_eq!(p, before);
    p.resolve_transfer(&coll(NOW + EXPIRY + 1), true).unwrap();
    assert_eq!(p, before);
}

#[test]
fn consents_and_listing_cleared_on_rotation() {
    let mut p = settled_piece(&cur_ft());
    p.consents.cancel_owner = Some(1);
    p.rotate_owner(&coll(NOW), client(), buyer(), false).unwrap();
    assert_eq!(p.consents, Consents::default());
    assert!(p.listing.is_none());
}

#[test]
fn old_holder_loses_owner_actions_after_transfer() {
    let mut p = settled_piece(&cur_ft());
    p.holder_pool = 10_000;
    p.rotate_owner(&coll(NOW), client(), buyer(), false).unwrap();
    assert_eq!(p.withdraw(&cx(&client(), 1, NOW + 1)), Err(Error::NotOwner));
    assert_eq!(p.list(&cx(&client(), 1, NOW + 1), LIST_PRICE, None), Err(Error::NotOwner));
}
