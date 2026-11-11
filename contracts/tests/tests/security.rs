//! Money-safety under hostile tokens, minimum gas, zero storage headroom and limited keys.
use near_workspaces::types::{AccessKey, Gas, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountDetailsPatch, AccountId};
use serde_json::json;
use tests::*;

const BYTE: u128 = 10_000_000_000_000_000_000; // yocto per byte of storage

/// Set the piece's NEAR balance to exactly what its storage and NEAR liabilities need.
async fn zero_headroom(w: &World, piece: &AccountId) -> anyhow::Result<()> {
    let usage = w.worker.view_account(piece).await?.storage_usage as u128;
    let acc = w.accounting(piece).await?;
    let near_liab: u128 = if acc["currency"] == "Near" { acc["liabilities"].as_str().unwrap().parse()? } else { 0 };
    let bal = usage * BYTE + near_liab;
    // Start from the current details: a bare patch would drop the global-contract reference.
    w.worker
        .patch(piece)
        .account_from_current(move |cur| AccountDetailsPatch::from(cur).balance(NearToken::from_yoctonear(bal)))
        .transact()
        .await?;
    assert_eq!(w.near_balance(piece).await?, bal);
    Ok(())
}

async fn storage_covered(w: &World, piece: &AccountId) -> anyhow::Result<()> {
    let a = w.worker.view_account(piece).await?;
    let acc = w.accounting(piece).await?;
    let near_liab: u128 = if acc["currency"] == "Near" { acc["liabilities"].as_str().unwrap().parse()? } else { 0 };
    assert!(a.balance.as_yoctonear() >= a.storage_usage as u128 * BYTE + near_liab, "storage not covered: {a:?}");
    Ok(())
}

fn claim_to(who: &Account, piece: &AccountId, to: &AccountId, gas: Gas) -> near_workspaces::operations::CallTransaction {
    who.call(piece, "claim_to").args_json(json!({ "recipient": to })).deposit(NearToken::from_yoctonear(1)).gas(gas)
}

#[tokio::test]
async fn claim_to_unregistered_ft_restores_credit_min_gas_zero_headroom() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (_, piece) = w.settled(true, 10 * USDC).await?;
    let nobody = w.fresh("nobody", 5).await?;
    zero_headroom(&w, &piece).await?;
    let min = Gas::from_tgas(common::gas::MIN_CLAIM_FT.as_tgas());
    fails_with(claim_to(&w.artist, &piece, nobody.id(), Gas::from_tgas(min.as_tgas() - 1)).transact().await?, "ERR_NOT_ENOUGH_GAS")?;
    let r = landed(claim_to(&w.artist, &piece, nobody.id(), min).transact().await?)?;
    assert!(r.logs().iter().any(|l| l.contains("claim_restored")), "{:?}", r.logs());
    assert_eq!(w.credit(&piece, w.artist.id()).await?, (10 * USDC, 0));
    storage_covered(&w, &piece).await?;
    // Still claimable afterwards, at minimum gas, to a registered account.
    let s0 = w.usdc_balance(w.shop.id()).await?;
    ok(claim_to(&w.artist, &piece, w.shop.id(), min).transact().await?)?;
    assert_eq!(w.usdc_balance(w.shop.id()).await? - s0, 10 * USDC);
    Ok(())
}

#[tokio::test]
async fn usdc_blacklisted_creditor_can_claim_to_other() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (_, piece) = w.settled(true, 10 * USDC).await?;
    w.blacklist(w.artist.id(), true).await?;
    landed(w.artist.call(&piece, "claim").max_gas().transact().await?)?;
    assert_eq!(w.credit(&piece, w.artist.id()).await?, (10 * USDC, 0));
    let s0 = w.usdc_balance(w.shop.id()).await?;
    ok(claim_to(&w.artist, &piece, w.shop.id(), Gas::from_tgas(100)).transact().await?)?;
    assert_eq!(w.usdc_balance(w.shop.id()).await? - s0, 10 * USDC);
    assert_eq!(w.credit(&piece, w.artist.id()).await?, (0, 0));
    Ok(())
}

/// A resale where the seller has never held a credit entry, on a piece with no spare NEAR:
/// the FT buy carries no NEAR, so the bytes for the seller's credit must already be paid.
#[tokio::test]
async fn ft_buy_when_seller_credit_new_on_min_reserve() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (_, piece) = w.settled(true, 10 * USDC).await?;
    let nonce = w.list(&w.client, &piece, 20 * USDC).await?;
    ok(w.buy_ft(&w.buyer, &piece, 20 * USDC, nonce, 0).await?)?;
    assert_eq!(w.credit(&piece, w.buyer.id()).await?, (0, 0), "buyer has no credit entry");
    zero_headroom(&w, &piece).await?;
    // The lister pays for the buy's bytes: one yocto is not enough...
    fails_with(w.act(&w.buyer, &piece, "list", json!({ "price": (30 * USDC).to_string() })).await?, "ERR_STORAGE")?;
    // ...a storage deposit is, and the piece keeps only the buy reserve.
    let p0 = w.near_balance(&piece).await?;
    ok(w.buyer.call(&piece, "list").args_json(json!({ "price": (30 * USDC).to_string() })).deposit(NearToken::from_millinear(10)).max_gas().transact().await?)?;
    let kept = w.near_balance(&piece).await? - p0;
    assert!(kept <= 300 * BYTE, "kept {kept}");
    let nonce: u64 = w.view(&piece, "listing", json!({})).await?["nonce"].as_str().unwrap().parse()?;
    let b0 = w.usdc_balance(w.buyer2.id()).await?;
    let r = ok(w.buy_ft(&w.buyer2, &piece, 30 * USDC, nonce, 0).await?)?;
    assert!(r.logs().iter().any(|l| l.contains("\"sold\"")), "{:?}", r.logs());
    assert_eq!(w.usdc_balance(w.buyer2.id()).await?, b0 - 30 * USDC);
    assert_eq!(w.info(&piece).await?["owner"], w.buyer2.id().as_str());
    assert_eq!(w.credit(&piece, w.buyer.id()).await?.0, 30 * USDC - 30 * USDC * 500 / 10_000);
    storage_covered(&w, &piece).await
}

#[tokio::test]
async fn new_owner_can_withdraw_on_min_reserve_ft_piece() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (_, piece) = w.settled(true, 10 * USDC).await?;
    let nonce = w.list(&w.client, &piece, 20 * USDC).await?;
    ok(w.buy_ft(&w.buyer, &piece, 20 * USDC, nonce, 0).await?)?;
    ok(w.pay_income_ft(&w.shop, &piece, 2 * USDC).await?)?;
    zero_headroom(&w, &piece).await?;
    // One yocto cannot pay for the new owner's credit entry...
    fails_with(w.act(&w.buyer, &piece, "withdraw", json!({})).await?, "ERR_STORAGE")?;
    // ...a storage deposit can, and the unused part comes back.
    let p0 = w.near_balance(&piece).await?;
    let b0 = w.usdc_balance(w.buyer.id()).await?;
    ok(w.buyer.call(&piece, "withdraw").deposit(NearToken::from_millinear(10)).max_gas().transact().await?)?;
    assert_eq!(w.usdc_balance(w.buyer.id()).await? - b0, 2 * USDC);
    let kept = w.near_balance(&piece).await? - p0;
    assert!(kept > 0 && kept <= 150 * BYTE, "the piece kept only the new entry's bytes, kept {kept}");
    storage_covered(&w, &piece).await
}

async fn near_claim_to_ghost(w: &World) -> anyhow::Result<(AccountId, Out)> {
    let (_, piece) = w.settled(false, NEAR).await?;
    let ghost: AccountId = format!("ghost.{}", w.root.id()).parse()?;
    let r = landed(claim_to(&w.artist, &piece, &ghost, Gas::from_tgas(common::gas::MIN_CLAIM_NEAR.as_tgas())).transact().await?)?;
    Ok((piece, r))
}

/// The transfer to a missing account fails; the callback restores the credit without looking at
/// the balance, even though the refund of the failed transfer has not landed yet.
#[tokio::test]
async fn failed_near_transfer_callback_before_refund() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (piece, r) = near_claim_to_ghost(&w).await?;
    let cb = r
        .receipt_outcomes()
        .iter()
        .find(|o| o.logs.iter().any(|l| l.contains("claim_restored")))
        .expect("restore callback ran")
        .clone();
    assert!(cb.is_success(), "{cb:?}");
    assert_eq!(cb.executor_id, piece);
    assert_eq!(w.credit(&piece, w.artist.id()).await?, (NEAR, 0));
    Ok(())
}

#[tokio::test]
async fn failed_near_transfer_invariant_converges() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (piece, _) = near_claim_to_ghost(&w).await?;
    w.worker.fast_forward(3).await?;
    // I1: the balance again covers storage plus everything owed.
    storage_covered(&w, &piece).await?;
    let a0 = w.near_balance(w.artist.id()).await?;
    ok(w.artist.call(&piece, "claim").max_gas().transact().await?)?;
    assert!(w.near_balance(w.artist.id()).await? - a0 > NEAR - NEAR / 20);
    storage_covered(&w, &piece).await
}

#[tokio::test]
async fn callbacks_succeed_at_min_gas() -> anyhow::Result<()> {
    let w = World::new().await?;
    // FT claim at its minimum.
    let (id, piece) = w.settled(true, 10 * USDC).await?;
    let a0 = w.usdc_balance(w.artist.id()).await?;
    ok(w.artist.call(&piece, "claim").gas(Gas::from_tgas(common::gas::MIN_CLAIM_FT.as_tgas())).transact().await?)?;
    assert_eq!(w.usdc_balance(w.artist.id()).await? - a0, 10 * USDC);
    // NEAR claim at its minimum.
    let (_, npiece) = w.settled(false, NEAR).await?;
    fails_with(w.artist.call(&npiece, "claim").gas(Gas::from_tgas(common::gas::MIN_CLAIM_NEAR.as_tgas() - 1)).transact().await?, "ERR_NOT_ENOUGH_GAS")?;
    ok(w.artist.call(&npiece, "claim").gas(Gas::from_tgas(common::gas::MIN_CLAIM_NEAR.as_tgas())).transact().await?)?;
    assert_eq!(w.credit(&npiece, w.artist.id()).await?, (0, 0));
    // nft_transfer_call at its minimum completes the whole chain (rotate, receiver, resolve, sync).
    let min = Gas::from_tgas(common::gas::MIN_TRANSFER_CALL.as_tgas());
    fails_with(
        w.client
            .call(&w.collection, "nft_transfer_call")
            .args_json(json!({ "receiver_id": w.evil.id(), "token_id": id, "msg": "keep" }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(min.as_tgas() - 1))
            .transact()
            .await?,
        "ERR_NOT_ENOUGH_GAS",
    )?;
    ok(w.client
        .call(&w.collection, "nft_transfer_call")
        .args_json(json!({ "receiver_id": w.evil.id(), "token_id": id, "msg": "keep" }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(min)
        .transact()
        .await?)?;
    assert_eq!(w.info(&piece).await?["owner"], w.evil.id().as_str());
    assert_eq!(w.index_owner(&id).await?, w.evil.id().as_str());
    Ok(())
}

#[tokio::test]
async fn function_call_key_cannot_list_withdraw_accept() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (_, settled) = w.settled(true, 10 * USDC).await?;
    ok(w.pay_income_ft(&w.shop, &settled, USDC).await?)?;
    let (_, delivered, t) = w.commission(true, 10 * USDC).await?;
    ok(w.fund(&delivered, &t, &w.client).await?)?;
    w.deliver(&delivered).await?;
    for (piece, calls) in [(&settled, vec![("list", json!({ "price": "20000000" })), ("withdraw", json!({}))]), (&delivered, vec![("accept", json!({}))])] {
        let sk = SecretKey::from_random(KeyType::ED25519);
        ok(w.client
            .batch(w.client.id())
            .add_key(sk.public_key(), AccessKey::function_call_access(piece, &[], Some(NearToken::from_near(1))))
            .transact()
            .await?)?;
        let fc = Account::from_secret_key(w.client.id().clone(), sk, &w.worker);
        for (m, args) in calls {
            // A function-call key cannot attach a deposit at all...
            let with_deposit = fc.call(piece, m).args_json(args.clone()).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(50)).transact().await;
            assert!(with_deposit.is_err() || !with_deposit.as_ref().unwrap().is_success(), "{m} with deposit via FC key");
            // ...and without one the gated method refuses.
            fails_with(fc.call(piece, m).args_json(args).gas(Gas::from_tgas(50)).transact().await?, "ERR_REQUIRES_DEPOSIT")?;
        }
    }
    assert_eq!(w.info(&delivered).await?["status"], "Delivered");
    assert!(w.view(&settled, "listing", json!({})).await?.is_null());
    assert_eq!(w.holder_pool(&settled).await?, USDC);
    Ok(())
}

#[tokio::test]
async fn claim_for_other_account_not_possible() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (_, piece) = w.settled(true, 10 * USDC).await?;
    fails_with(w.buyer.call(&piece, "claim").max_gas().transact().await?, "ERR_NOTHING_TO_CLAIM")?;
    fails_with(claim_to(&w.buyer, &piece, w.buyer.id(), Gas::from_tgas(100)).transact().await?, "ERR_NOTHING_TO_CLAIM")?;
    // `claim` takes no account argument; extra args are ignored and the predecessor is used.
    let _ = w.buyer.call(&piece, "claim").args_json(json!({ "account": w.artist.id() })).max_gas().transact().await?;
    fails_with(claim_to(&w.artist, &piece, &piece, Gas::from_tgas(100)).transact().await?, "ERR_INVALID_RECIPIENT")?;
    assert_eq!(w.credit(&piece, w.artist.id()).await?, (10 * USDC, 0));
    Ok(())
}

#[tokio::test]
async fn pay_income_rejected_on_personal_grant() -> anyhow::Result<()> {
    let w = World::new().await?;
    let mut t = w.terms(true, 10 * USDC, 600).await?;
    t.grant = common::Grant { kind: common::GrantType::Personal, attribution: true, transferable: true };
    let id = w.create(common::PieceKind::Commission(t.clone())).await?;
    let piece = w.piece_id(&id);
    ok(w.fund(&piece, &t, &w.client).await?)?;
    w.deliver(&piece).await?;
    ok(w.act(&w.client, &piece, "accept", json!({})).await?)?;
    let s0 = w.usdc_balance(w.shop.id()).await?;
    let r = w.pay_income_ft(&w.shop, &piece, USDC).await?;
    assert!(r.logs().iter().any(|l| l.contains("ERR_INCOME_NOT_LICENSED")), "{:?}", r.logs());
    assert_eq!(w.usdc_balance(w.shop.id()).await?, s0, "refunded in full");
    assert_eq!(w.holder_pool(&piece).await?, 0);
    Ok(())
}
