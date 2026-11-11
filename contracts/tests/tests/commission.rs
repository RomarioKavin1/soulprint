//! Commission lifecycle on a real sandbox: happy paths, revision, refund, dispute ladder, standalone.
use near_workspaces::types::NearToken;
use serde_json::json;
use tests::*;

#[tokio::test]
async fn happy_path_ft() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (id, piece, t) = w.commission(true, 100 * USDC).await?;
    assert_eq!(w.index_owner(&id).await?, w.artist.id().as_str());
    let before = w.usdc_balance(w.client.id()).await?;
    ok(w.fund(&piece, &t, &w.client).await?)?;
    assert_eq!(w.usdc_balance(w.client.id()).await?, before - 100 * USDC);
    assert_eq!(w.usdc_balance(&piece).await?, 100 * USDC);
    let info = w.info(&piece).await?;
    assert_eq!(info["status"], "InProgress");
    assert_eq!(info["owner"], w.client.id().as_str());
    assert_eq!(w.index_owner(&id).await?, w.client.id().as_str());
    w.deliver(&piece).await?;
    ok(w.act(&w.client, &piece, "accept", json!({})).await?)?;
    assert_eq!(w.info(&piece).await?["status"], "Settled");
    let a0 = w.usdc_balance(w.artist.id()).await?;
    ok(w.artist.call(&piece, "claim").max_gas().transact().await?)?;
    assert_eq!(w.usdc_balance(w.artist.id()).await? - a0, 100 * USDC);
    assert_eq!(w.credit(&piece, w.artist.id()).await?, (0, 0));
    Ok(())
}

/// A3 on an FT piece: the owner-change notify lands without any extra deposit from the funder.
#[tokio::test]
async fn fund_notify_succeeds_on_ft_piece_without_extra_deposit() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (id, piece, t) = w.commission(true, 10 * USDC).await?;
    let r = ok(w.fund(&piece, &t, &w.client).await?)?;
    assert!(r.logs().iter().any(|l| l.contains("nft_transfer")), "{:?}", r.logs());
    assert_eq!(w.index_owner(&id).await?, w.client.id().as_str());
    let seq: serde_json::Value = w.view(&w.collection, "token_seq", json!({ "token_id": id })).await?;
    assert_eq!(seq, "1");
    Ok(())
}

#[tokio::test]
async fn happy_path_near() -> anyhow::Result<()> {
    let w = World::new().await?;
    let price = 2 * NEAR;
    let (id, piece, t) = w.commission(false, price).await?;
    ok(w.fund(&piece, &t, &w.client).await?)?;
    assert_eq!(w.index_owner(&id).await?, w.client.id().as_str());
    let acc = w.accounting(&piece).await?;
    assert_eq!(acc["escrow"], price.to_string());
    w.deliver(&piece).await?;
    ok(w.act(&w.client, &piece, "release_milestone", json!({ "index": 0 })).await?)?;
    ok(w.act(&w.client, &piece, "accept", json!({})).await?)?;
    let a0 = w.near_balance(w.artist.id()).await?;
    ok(w.artist.call(&piece, "claim").max_gas().transact().await?)?;
    let gained = w.near_balance(w.artist.id()).await? - a0;
    assert!(gained > price - NEAR / 20 && gained <= price, "gained {gained} (price minus the claimer's gas)");
    assert_eq!(w.credit(&piece, w.artist.id()).await?, (0, 0));
    // The piece still covers its own storage after paying out.
    let acc = w.accounting(&piece).await?;
    assert_eq!(acc["liabilities"], "0");
    Ok(())
}

#[tokio::test]
async fn revision_round_then_accept() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (_, piece, t) = w.commission(true, 10 * USDC).await?;
    ok(w.fund(&piece, &t, &w.client).await?)?;
    w.deliver(&piece).await?;
    let d0: u64 = w.info(&piece).await?["deadline"].as_str().unwrap().parse()?;
    ok(w.act(&w.client, &piece, "request_changes", json!({})).await?)?;
    let info = w.info(&piece).await?;
    assert_eq!(info["status"], "InProgress");
    assert_eq!(info["revisions_used"], 1);
    let d1: u64 = info["deadline"].as_str().unwrap().parse()?;
    assert!(d1 >= d0, "A11: deadline never shrinks");
    // Cannot accept while in progress.
    fails_with(w.act(&w.client, &piece, "accept", json!({})).await?, "ERR_WRONG_STATUS")?;
    w.deliver(&piece).await?;
    ok(w.act(&w.client, &piece, "accept", json!({})).await?)?;
    assert_eq!(w.info(&piece).await?["status"], "Settled");
    Ok(())
}

#[tokio::test]
async fn refund_after_deadline_and_grace() -> anyhow::Result<()> {
    let w = World::new().await?;
    let t = w.terms(true, 10 * USDC, 15).await?;
    let id = w.create(common::PieceKind::Commission(t.clone())).await?;
    let piece = w.piece_id(&id);
    let c0 = w.usdc_balance(w.client.id()).await?;
    ok(w.fund(&piece, &t, &w.client).await?)?;
    fails_with(w.act(&w.client, &piece, "claim_refund", json!({})).await?, "ERR_REFUND_NOT_YET")?;
    w.sleep(18).await?;
    assert_eq!(w.info(&piece).await?["refund_eligible"], true);
    fails_with(w.act(&w.artist, &piece, "deliver", json!({ "final_file_hash": common::Bytes32([1; 32]), "report_hash": common::Bytes32([1; 32]) })).await?, "ERR")?;
    ok(w.act(&w.client, &piece, "claim_refund", json!({})).await?)?;
    let info = w.info(&piece).await?;
    assert_eq!(info["status"], "Refunded");
    ok(w.client.call(&piece, "claim").max_gas().transact().await?)?;
    assert_eq!(w.usdc_balance(w.client.id()).await?, c0);
    Ok(())
}

/// Each dispute stage resolves through its own door: negotiation (split), arbitrator, fallback,
/// timeout (7500 to the artist by default). Four pieces in one world, staggered in time.
#[tokio::test]
async fn dispute_ladder_each_stage() -> anyhow::Result<()> {
    let w = World::new().await?;
    let price = 100 * USDC;
    let mut pieces = vec![];
    for _ in 0..4 {
        let (_, piece, t) = w.commission(true, price).await?;
        ok(w.fund(&piece, &t, &w.client).await?)?;
        w.deliver(&piece).await?;
        pieces.push(piece);
    }
    let bond = price * 500 / 10_000;
    for p in &pieces {
        // NEAR attach on an FT piece is refused; the bond comes in as an FT `reject` action.
        fails_with(
            w.client.call(p, "reject").deposit(NearToken::from_yoctonear(bond)).max_gas().transact().await?,
            "ERR_WRONG_CURRENCY",
        )?;
        ok(w.ft_action(&w.client, p, bond, json!({ "action": "reject" })).await?)?;
        let info = w.info(p).await?;
        assert_eq!(info["status"], "Disputed");
        assert_eq!(info["dispute_stage"], "Negotiation");
        assert_eq!(w.accounting(p).await?["bond"], bond.to_string());
    }
    // Stage 1: negotiated split, artist proposes 6000, client accepts.
    ok(w.act(&w.artist, &pieces[0], "propose_split", json!({ "artist_bps": 6000 })).await?)?;
    let nonce = w.info(&pieces[0]).await?["split"]["nonce"].as_u64().unwrap();
    fails_with(w.act(&w.client, &pieces[0], "accept_split", json!({ "expected_artist_bps": 5000, "proposal_nonce": nonce })).await?, "ERR_PROPOSAL_CHANGED")?;
    ok(w.act(&w.client, &pieces[0], "accept_split", json!({ "expected_artist_bps": 6000, "proposal_nonce": nonce })).await?)?;
    assert_eq!(w.info(&pieces[0]).await?["status"], "Settled");
    assert_eq!(w.credit(&pieces[0], w.artist.id()).await?.0, price * 6 / 10 + bond);
    assert_eq!(w.credit(&pieces[0], w.client.id()).await?.0, price * 4 / 10);
    // Arbitrator cannot act during negotiation.
    fails_with(w.act(&w.arb, &pieces[1], "resolve", json!({ "artist_bps": 2000 })).await?, "ERR_WRONG_STAGE")?;

    // Stage 2: arbitrator.
    w.sleep(21).await?;
    assert_eq!(w.info(&pieces[1]).await?["dispute_stage"], "Arbitrator");
    fails_with(w.act(&w.fallback, &pieces[1], "resolve", json!({ "artist_bps": 2000 })).await?, "ERR_NOT_ARBITRATOR")?;
    ok(w.act(&w.arb, &pieces[1], "resolve", json!({ "artist_bps": 2000 })).await?)?;
    let info = w.info(&pieces[1]).await?;
    assert_eq!(info["status"], "Refunded");
    assert_eq!(info["owner"], w.artist.id().as_str(), "refund returns the piece to the artist");
    assert_eq!(w.credit(&pieces[1], w.client.id()).await?.0, price * 8 / 10 + bond);

    // Stage 3: fallback arbitrator.
    w.sleep(20).await?;
    assert_eq!(w.info(&pieces[2]).await?["dispute_stage"], "Fallback");
    fails_with(w.act(&w.arb, &pieces[2], "resolve", json!({ "artist_bps": 5000 })).await?, "ERR_NOT_ARBITRATOR")?;
    ok(w.act(&w.fallback, &pieces[2], "resolve", json!({ "artist_bps": 5000 })).await?)?;
    assert_eq!(w.info(&pieces[2]).await?["status"], "Settled", "tie goes to the artist");

    // Stage 4: timeout, permissionless, terms' 7500.
    w.sleep(20).await?;
    assert_eq!(w.info(&pieces[3]).await?["dispute_stage"], "TimedOut");
    ok(w.buyer.call(&pieces[3], "timeout_resolve").max_gas().transact().await?)?;
    assert_eq!(w.credit(&pieces[3], w.artist.id()).await?.0, price * 75 / 100 + bond);
    assert_eq!(w.credit(&pieces[3], w.client.id()).await?.0, price * 25 / 100);

    // Every piece holds exactly what it owes.
    for p in &pieces {
        let acc = w.accounting(p).await?;
        assert_eq!(w.usdc_balance(p).await?, credits_total(&acc));
    }
    Ok(())
}

#[tokio::test]
async fn standalone_settle_list_buy() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (id, piece) = w.standalone(true, 1000, true).await?;
    let info = w.info(&piece).await?;
    assert_eq!(info["mode"], "Standalone");
    assert_eq!(info["status"], "Settled");
    assert_eq!(info["owner"], w.artist.id().as_str());
    let nonce = w.list(&w.artist, &piece, 50 * USDC).await?;
    ok(w.buy_ft(&w.buyer, &piece, 50 * USDC, nonce, 0).await?)?;
    assert_eq!(w.info(&piece).await?["owner"], w.buyer.id().as_str());
    assert_eq!(w.index_owner(&id).await?, w.buyer.id().as_str());
    // Artist is both seller and royalty receiver: the whole price.
    assert_eq!(w.credit(&piece, w.artist.id()).await?.0, 50 * USDC);
    Ok(())
}

/// Review C1: an FT commission with a zero reject bond would leave the client no way to reject.
#[tokio::test]
async fn ft_commission_with_zero_reject_bond_is_refused() -> anyhow::Result<()> {
    let w = World::new().await?;
    let mut t = w.terms(true, 100 * USDC, 600).await?;
    t.reject_bond_bps = 0;
    let cost = w.creation_cost(true).await?;
    let r = w
        .artist
        .call(&w.collection, "create_piece")
        .args_json(json!({ "kind": common::PieceKind::Commission(t), "capture_pubkey": ed_pk(&w.capture) }))
        .deposit(NearToken::from_yoctonear(cost))
        .max_gas()
        .transact()
        .await?;
    fails_with(r, "ERR_TERMS_Bond")?;
    Ok(())
}
