//! Track requirement: income and sales racing each other never pays twice and never strands funds.
//! Income belongs to whoever owns the piece at `withdraw` time (T2); sale proceeds belong to the seller.
use serde_json::json;
use tests::*;

const PRICE: u128 = 50 * USDC;
const ROYALTY: u128 = PRICE * 500 / 10_000;

/// Every unit of USDC the piece holds is owed to someone, plus the holder pool.
async fn conserved(w: &World, piece: &near_workspaces::AccountId) -> anyhow::Result<()> {
    let acc = w.accounting(piece).await?;
    let pool: u128 = acc["holder_pool"].as_str().unwrap().parse()?;
    assert_eq!(w.usdc_balance(piece).await?, credits_total(&acc) + pool, "{acc}");
    Ok(())
}

#[tokio::test]
async fn income_promise_lands_before_buy() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (_, piece) = w.settled(true, 10 * USDC).await?;
    let artist0 = w.credit(&piece, w.artist.id()).await?.0; // the unclaimed commission payment
    let nonce = w.list(&w.client, &piece, PRICE).await?;
    ok(w.pay_income_ft(&w.shop, &piece, 5 * USDC).await?)?;
    assert_eq!(w.holder_pool(&piece).await?, 5 * USDC);
    // A buyer who expects more pool than exists is refunded in full (T13).
    let b0 = w.usdc_balance(w.buyer.id()).await?;
    let r = w.buy_ft(&w.buyer, &piece, PRICE, nonce, 6 * USDC).await?;
    assert!(r.logs().iter().any(|l| l.contains("ERR_POOL_BELOW_EXPECTED")), "{:?}", r.logs());
    assert_eq!(w.usdc_balance(w.buyer.id()).await?, b0);
    ok(w.buy_ft(&w.buyer, &piece, PRICE, nonce, 5 * USDC).await?)?;
    assert_eq!(w.info(&piece).await?["owner"], w.buyer.id().as_str());
    // The pool came with the piece.
    fails_with(w.act(&w.client, &piece, "withdraw", json!({})).await?, "ERR_NOT_OWNER")?;
    ok(w.act(&w.buyer, &piece, "withdraw", json!({})).await?)?;
    assert_eq!(w.usdc_balance(w.buyer.id()).await?, b0 - PRICE + 5 * USDC);
    assert_eq!(w.credit(&piece, w.client.id()).await?.0, PRICE - ROYALTY);
    assert_eq!(w.credit(&piece, w.artist.id()).await?.0 - artist0, ROYALTY);
    conserved(&w, &piece).await
}

#[tokio::test]
async fn income_lands_after_buy() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (_, piece) = w.settled(true, 10 * USDC).await?;
    let nonce = w.list(&w.client, &piece, PRICE).await?;
    ok(w.buy_ft(&w.buyer, &piece, PRICE, nonce, 0).await?)?;
    ok(w.pay_income_ft(&w.shop, &piece, 3 * USDC).await?)?;
    fails_with(w.act(&w.client, &piece, "withdraw", json!({})).await?, "ERR_NOT_OWNER")?;
    let b0 = w.usdc_balance(w.buyer.id()).await?;
    ok(w.act(&w.buyer, &piece, "withdraw", json!({})).await?)?;
    assert_eq!(w.usdc_balance(w.buyer.id()).await? - b0, 3 * USDC);
    fails_with(w.act(&w.buyer, &piece, "withdraw", json!({})).await?, "ERR_POOL_EMPTY")?;
    assert_eq!(w.credit(&piece, w.client.id()).await?.0, PRICE - ROYALTY);
    conserved(&w, &piece).await
}

/// The seller's withdraw is dispatched and, racing it, the piece is listed and bought. Whatever
/// order the chain picks, the pool is paid exactly once and the sale proceeds go to the seller.
#[tokio::test]
async fn claim_in_flight_during_buy() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (_, piece) = w.settled(true, 10 * USDC).await?;
    ok(w.pay_income_ft(&w.shop, &piece, 4 * USDC).await?)?;
    let (c0, b0) = (w.usdc_balance(w.client.id()).await?, w.usdc_balance(w.buyer.id()).await?);
    let withdraw = w.client.call(&piece, "withdraw").args_json(json!({})).deposit(near_workspaces::types::NearToken::from_yoctonear(1)).max_gas().transact_async().await?;
    let list = w.act(&w.client, &piece, "list", json!({ "price": PRICE.to_string() })).await?;
    let withdraw = wait(withdraw).await?;
    let listed = list.is_success() && list.receipt_failures().is_empty();
    if listed {
        ok(w.buy_ft(&w.buyer, &piece, PRICE, 1, 0).await?)?;
    }
    // Drain whatever is left to whoever it belongs to.
    for who in [&w.client, &w.buyer] {
        if w.credit(&piece, who.id()).await?.0 > 0 {
            ok(who.call(&piece, "claim").max_gas().transact().await?)?;
        }
    }
    if w.holder_pool(&piece).await? > 0 {
        let owner = w.info(&piece).await?["owner"].as_str().unwrap().to_string();
        let o = if owner == w.buyer.id().as_str() { &w.buyer } else { &w.client };
        ok(w.act(o, &piece, "withdraw", json!({})).await?)?;
    }
    let (c1, b1) = (w.usdc_balance(w.client.id()).await?, w.usdc_balance(w.buyer.id()).await?);
    let sale = if listed { PRICE } else { 0 };
    // Client + buyer together gained exactly the pool, minus the royalty if a sale happened.
    assert_eq!((c1 + b1) as i128 - (c0 + b0) as i128, (4 * USDC) as i128 - if listed { ROYALTY as i128 } else { 0 });
    if withdraw.is_success() && withdraw.receipt_failures().is_empty() {
        assert_eq!(c1 - c0, 4 * USDC + sale - if listed { ROYALTY } else { 0 }, "seller got pool + proceeds");
    }
    assert_eq!(w.holder_pool(&piece).await?, 0);
    conserved(&w, &piece).await
}

#[tokio::test]
async fn withdraw_then_list_then_sold_then_claim_fails_restores_to_seller() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (_, piece) = w.settled(true, 10 * USDC).await?;
    ok(w.pay_income_ft(&w.shop, &piece, 5 * USDC).await?)?;
    w.blacklist(w.client.id(), true).await?;
    let r = landed(w.act(&w.client, &piece, "withdraw", json!({})).await?)?;
    assert!(r.logs().iter().any(|l| l.contains("claim_restored")), "{:?}", r.logs());
    assert_eq!(w.credit(&piece, w.client.id()).await?, (5 * USDC, 0));
    let nonce = w.list(&w.client, &piece, PRICE).await?;
    ok(w.buy_ft(&w.buyer, &piece, PRICE, nonce, 0).await?)?;
    // Still blacklisted: the claim fails and restores to the seller, never to the new owner.
    let r = landed(w.client.call(&piece, "claim").max_gas().transact().await?)?;
    assert!(r.logs().iter().any(|l| l.contains("claim_restored")), "{:?}", r.logs());
    assert_eq!(w.credit(&piece, w.client.id()).await?, (5 * USDC + PRICE - ROYALTY, 0));
    assert_eq!(w.credit(&piece, w.buyer.id()).await?, (0, 0));
    conserved(&w, &piece).await?;
    w.blacklist(w.client.id(), false).await?;
    let c0 = w.usdc_balance(w.client.id()).await?;
    ok(w.client.call(&piece, "claim").max_gas().transact().await?)?;
    assert_eq!(w.usdc_balance(w.client.id()).await? - c0, 5 * USDC + PRICE - ROYALTY);
    conserved(&w, &piece).await
}
