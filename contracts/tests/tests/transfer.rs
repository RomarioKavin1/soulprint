//! NEP-171 transfers through the collection, including hostile receivers (T9, A1, A40).
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::AccountId;
use serde_json::json;
use tests::*;

/// A settled FT piece owned by the client with 5 USDC of income in the pool.
async fn owned_with_pool(w: &World) -> anyhow::Result<(String, AccountId)> {
    let (id, piece) = w.settled(true, 10 * USDC).await?;
    ok(w.pay_income_ft(&w.shop, &piece, 5 * USDC).await?)?;
    Ok((id, piece))
}

async fn transfer_call(w: &World, id: &str, receiver: &AccountId, msg: &str) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(w.client
        .call(&w.collection, "nft_transfer_call")
        .args_json(json!({ "receiver_id": receiver, "token_id": id, "msg": msg }))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?)
}

async fn assert_reverted(w: &World, id: &str, piece: &AccountId) -> anyhow::Result<()> {
    let info = w.info(piece).await?;
    assert_eq!(info["owner"], w.client.id().as_str());
    assert!(info["transfer_pending"].is_null(), "{info}");
    assert!(w.view(piece, "listing", json!({})).await?.is_null());
    assert_eq!(w.index_owner(id).await?, w.client.id().as_str());
    assert_eq!(w.holder_pool(piece).await?, 5 * USDC);
    assert_eq!(w.usdc_balance(w.evil.id()).await?, 0);
    Ok(())
}

#[tokio::test]
async fn nft_transfer_moves_piece_and_index() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (id, piece) = owned_with_pool(&w).await?;
    let r = ok(w.act(&w.client, &w.collection, "nft_transfer", json!({ "receiver_id": w.buyer2.id(), "token_id": id })).await?)?;
    assert!(r.logs().iter().any(|l| l.contains("nft_transfer")), "{:?}", r.logs());
    assert_eq!(w.info(&piece).await?["owner"], w.buyer2.id().as_str());
    assert_eq!(w.index_owner(&id).await?, w.buyer2.id().as_str());
    // The pool moves with the piece.
    ok(w.act(&w.buyer2, &piece, "withdraw", json!({})).await?)?;
    Ok(())
}

#[tokio::test]
async fn transfer_call_receiver_cannot_drain() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (id, piece) = owned_with_pool(&w).await?;
    let r = transfer_call(&w, &id, w.evil.id(), "drain").await?;
    // The receiver's owner actions all failed: it was never the owner, and the piece was pending.
    let text = format!("{:?}", r.receipt_failures());
    assert!(text.contains("ERR_TRANSFER_PENDING") || text.contains("ERR_NOT_OWNER"), "{text}");
    assert_reverted(&w, &id, &piece).await
}

#[tokio::test]
async fn transfer_call_revert_cannot_be_blocked() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (id, piece) = owned_with_pool(&w).await?;
    for msg in ["return", "panic"] {
        let _ = transfer_call(&w, &id, w.evil.id(), msg).await?;
        assert_reverted(&w, &id, &piece).await?;
    }
    // "keep" is the only answer that completes the transfer.
    let _ = transfer_call(&w, &id, w.evil.id(), "keep").await?;
    assert_eq!(w.info(&piece).await?["owner"], w.evil.id().as_str());
    assert_eq!(w.index_owner(&id).await?, w.evil.id().as_str());
    Ok(())
}

#[tokio::test]
async fn receiver_out_of_gas_reverts() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (id, piece) = owned_with_pool(&w).await?;
    let _ = transfer_call(&w, &id, w.evil.id(), "gas").await?;
    assert_reverted(&w, &id, &piece).await
}

#[tokio::test]
async fn transfer_call_receiver_returns_4mib_still_resolves() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (id, piece) = owned_with_pool(&w).await?;
    let _ = transfer_call(&w, &id, w.evil.id(), "huge").await?;
    assert_reverted(&w, &id, &piece).await
}

#[tokio::test]
async fn resolve_path_does_not_grow_collection_storage() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (id, piece) = owned_with_pool(&w).await?;
    let before = w.worker.view_account(&w.collection).await?.storage_usage;
    for msg in ["return", "huge", "panic"] {
        let _ = transfer_call(&w, &id, w.evil.id(), msg).await?;
    }
    assert_reverted(&w, &id, &piece).await?;
    assert_eq!(w.worker.view_account(&w.collection).await?.storage_usage, before);
    Ok(())
}

#[tokio::test]
async fn nft_transfer_fails_visibly_when_piece_refuses() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (id, piece) = owned_with_pool(&w).await?;
    // Not the owner.
    fails_with(w.act(&w.buyer, &w.collection, "nft_transfer", json!({ "receiver_id": w.buyer.id(), "token_id": id })).await?, "ERR_PIECE_REFUSED")?;
    // Owner, but to the piece itself.
    fails_with(w.act(&w.client, &w.collection, "nft_transfer", json!({ "receiver_id": piece, "token_id": id })).await?, "ERR_PIECE_REFUSED")?;
    // Approvals are not supported.
    fails_with(
        w.act(&w.client, &w.collection, "nft_transfer", json!({ "receiver_id": w.buyer.id(), "token_id": id, "approval_id": 0 })).await?,
        "ERR_NO_APPROVALS",
    )?;
    // Exactly one yocto.
    fails_with(
        w.client.call(&w.collection, "nft_transfer").args_json(json!({ "receiver_id": w.buyer.id(), "token_id": id })).max_gas().transact().await?,
        "yocto",
    )?;
    assert_eq!(w.info(&piece).await?["owner"], w.client.id().as_str());
    assert_eq!(w.index_owner(&id).await?, w.client.id().as_str());
    Ok(())
}

/// Simulates a lost owner-change notify by patching the collection's index entry, then shows
/// that the permissionless `sync_owner` restores it from the piece (the piece is the truth).
#[tokio::test]
async fn index_resync_after_failed_notify() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (id, _piece) = owned_with_pool(&w).await?;
    let (from, to) = (w.client.id().as_str().as_bytes().to_vec(), w.buyer2.id().as_str().as_bytes().to_vec());
    assert_eq!(from.len(), to.len(), "same-length ids keep the borsh layout");
    let state = w.worker.view_state(&w.collection).await?;
    let artist = w.artist.id().as_str().as_bytes();
    let (key, mut value) = state
        .into_iter()
        .find(|(_, v)| v.windows(from.len()).any(|x| x == from.as_slice()) && v.windows(artist.len()).any(|x| x == artist))
        .expect("token entry");
    let at = value.windows(from.len()).position(|x| x == from.as_slice()).unwrap();
    value[at..at + to.len()].copy_from_slice(&to);
    // TokenEntry { owner, seq, .. }: a lost notify also leaves the older seq behind.
    let seq_at = at + to.len();
    let seq = u64::from_le_bytes(value[seq_at..seq_at + 8].try_into()?);
    assert_eq!(seq, 1, "funded once");
    value[seq_at..seq_at + 8].copy_from_slice(&0u64.to_le_bytes());
    w.worker.patch_state(&w.collection, &key, &value).await?;
    assert_eq!(w.index_owner(&id).await?, w.buyer2.id().as_str(), "index is stale");
    ok(w.buyer.call(&w.collection, "sync_owner").args_json(json!({ "token_id": id })).gas(Gas::from_tgas(100)).transact().await?)?;
    assert_eq!(w.index_owner(&id).await?, w.client.id().as_str());
    // A replayed older view can never roll it back.
    ok(w.buyer.call(&w.collection, "sync_owner").args_json(json!({ "token_id": id })).gas(Gas::from_tgas(100)).transact().await?)?;
    assert_eq!(w.view(&w.collection, "token_seq", json!({ "token_id": id })).await?, "1");
    Ok(())
}

#[tokio::test]
async fn nft_transfer_event_emitted_on_buy() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (id, piece) = w.settled(false, NEAR).await?;
    let nonce = w.list(&w.client, &piece, NEAR / 2).await?;
    let r = ok(w.buy_near(&w.buyer, &piece, NEAR / 2, nonce).await?)?;
    let ev = r.logs().into_iter().find(|l| l.contains("\"nft_transfer\"")).expect("nep171 nft_transfer");
    assert!(ev.contains(w.client.id().as_str()) && ev.contains(w.buyer.id().as_str()), "{ev}");
    assert!(r.logs().iter().any(|l| l.contains("\"sold\"")), "{:?}", r.logs());
    assert_eq!(w.index_owner(&id).await?, w.buyer.id().as_str());
    Ok(())
}
