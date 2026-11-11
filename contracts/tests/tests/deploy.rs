//! Deployment shape (A5, A8, C1), collection genesis and storage, creation failures, caps, paging.
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{AccountId, ContractState};
use serde_json::json;
use tests::*;

const BYTE: u128 = 10_000_000_000_000_000_000;

#[tokio::test]
async fn collection_created_keyless_in_one_tx() -> anyhow::Result<()> {
    // World::new creates the collection with one batch (create, transfer, deploy, new) signed by
    // the parent; no transaction is ever signed by the collection itself.
    let w = World::new().await?;
    assert!(w.worker.view_access_keys(&w.collection).await?.is_empty());
    let a = w.worker.view_account(&w.collection).await?;
    assert!(matches!(a.contract_state, ContractState::LocalHash(_)), "{:?}", a.contract_state);
    Ok(())
}

#[tokio::test]
async fn collection_genesis_state_is_clean() -> anyhow::Result<()> {
    let w = World::new().await?;
    let info = w.view(&w.collection, "collection_info", json!({})).await?;
    assert_eq!(info["governance"], w.gov.id().as_str());
    assert_eq!(info["network"], "sandbox");
    assert_eq!(info["next_token_id"], "1");
    assert_eq!(info["currencies"].as_array().unwrap().len(), 2);
    assert_eq!(w.view(&w.collection, "nft_total_supply", json!({})).await?, "0");
    let keys = w.view(&w.collection, "verifier_keys", json!({})).await?;
    assert_eq!(keys.as_array().unwrap().len(), 1);
    assert!(w.view(&w.collection, "revoked_keys", json!({})).await?.as_array().unwrap().is_empty());
    // `new` cannot run twice.
    fails_with(
        w.gov
            .call(&w.collection, "new")
            .args_json(json!({ "governance": w.gov.id(), "currencies": currencies(w.usdc.id()), "network": "x", "time": w.time, "initial_verifier_keys": [] }))
            .transact()
            .await?,
        "initialized",
    )?;
    Ok(())
}

#[tokio::test]
async fn piece_has_no_access_keys_and_code_hash_matches() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (_, piece, _) = w.commission(true, 10 * USDC).await?;
    assert!(w.worker.view_access_keys(&piece).await?.is_empty());
    let a = w.worker.view_account(&piece).await?;
    match a.contract_state {
        ContractState::GlobalHash(h) => assert_eq!(h.0, w.piece_code_hash),
        other => panic!("piece must use the global code by hash, got {other:?}"),
    }
    let info = w.view(&w.collection, "collection_info", json!({})).await?;
    let b: common::Bytes32 = serde_json::from_value(info["piece_code_hash"].clone())?;
    assert_eq!(b.0, w.piece_code_hash, "collection's compiled-in hash = sha256(res/piece.wasm)");
    // The piece's init ran once, by its parent; nobody can run it again.
    fails_with(
        w.artist
            .call(&piece, "init")
            .args_json(json!({ "kind": "x", "artist": w.artist.id(), "capture_pubkey": ed_pk(&w.capture), "time": w.time, "currency": currencies(w.usdc.id())[1] }))
            .transact()
            .await?,
        "",
    )?;
    Ok(())
}

#[tokio::test]
async fn collection_account_cannot_rotate_piece() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (id, piece) = w.settled(true, 10 * USDC).await?;
    // Only the collection may rotate, and the collection has no keys: no one can sign as it.
    assert!(w.worker.view_access_keys(&w.collection).await?.is_empty());
    for who in [&w.client, &w.artist, &w.gov] {
        fails_with(
            who.call(&piece, "rotate_owner").args_json(json!({ "sender": w.client.id(), "receiver": who.id(), "call": false })).transact().await?,
            "ERR_NOT_COLLECTION",
        )?;
        fails_with(who.call(&piece, "resolve_transfer").args_json(json!({ "revert": false })).transact().await?, "ERR_NOT_COLLECTION")?;
    }
    // Collection callbacks are private too (A4).
    fails_with(
        w.client.call(&w.collection, "on_rotated").args_json(json!({ "token_id": id, "owner": w.client.id(), "seq": "99" })).transact().await?,
        "",
    )?;
    assert_eq!(w.info(&piece).await?["owner"], w.client.id().as_str());
    assert_eq!(w.index_owner(&id).await?, w.client.id().as_str());
    Ok(())
}

#[tokio::test]
async fn collection_storage_covered() -> anyhow::Result<()> {
    let w = World::new().await?;
    let check = || async {
        let a = w.worker.view_account(&w.collection).await?;
        assert!(a.balance.as_yoctonear() >= a.storage_usage as u128 * BYTE, "{a:?}");
        anyhow::Ok(a.balance.as_yoctonear() - a.storage_usage as u128 * BYTE)
    };
    let h0 = check().await?;
    // Many pieces, transfers to many new owners: each creation's reserve pays the index growth.
    for i in 0..4 {
        let (id, _) = w.standalone(i % 2 == 0, 500, true).await?;
        let to = w.fresh(Box::leak(format!("owner{i}").into_boxed_str()), 2).await?;
        ok(w.act(&w.artist, &w.collection, "nft_transfer", json!({ "receiver_id": to.id(), "token_id": id })).await?)?;
        check().await?;
    }
    assert!(check().await? >= h0, "headroom never shrinks below genesis");
    Ok(())
}

#[tokio::test]
async fn create_piece_with_paused_token_registers_piece_and_partial_refund() -> anyhow::Result<()> {
    let w = World::new().await?;
    let reg = 1_250_000_000_000_000_000_000u128; // FT_REGISTRATION
    let cost = w.creation_cost(true).await?;
    let create = |paused: bool| {
        let w = &w;
        async move {
            let t = w.terms(true, 10 * USDC, 600).await?;
            w.pause_usdc(paused).await?;
            let a0 = w.near_balance(w.artist.id()).await?;
            let r = landed(w
                .artist
                .call(&w.collection, "create_piece")
                .args_json(json!({ "kind": common::PieceKind::Commission(t), "capture_pubkey": ed_pk(&w.capture) }))
                .deposit(NearToken::from_yoctonear(cost))
                .gas(Gas::from_tgas(150))
                .transact()
                .await?)?;
            assert!(r.logs().iter().any(|l| l.contains("piece_created")), "{:?}", r.logs());
            w.pause_usdc(false).await?;
            anyhow::Ok(a0 - w.near_balance(w.artist.id()).await?)
        }
    };
    let normal = create(false).await?;
    let paused = create(true).await?;
    // Registered piece vs unregistered piece: the only difference is the refunded registration.
    let diff = normal as i128 - paused as i128;
    assert!((diff - reg as i128).abs() < (reg / 3) as i128, "normal {normal} paused {paused} diff {diff}");
    let p2 = w.piece_id("2");
    assert!(w.view(w.usdc.id(), "storage_balance_of", json!({ "account_id": p2 })).await?.is_null());
    assert!(!w.view(w.usdc.id(), "storage_balance_of", json!({ "account_id": w.piece_id("1") })).await?.is_null());
    // The piece itself exists and is indexed.
    assert_eq!(w.index_owner("2").await?, w.artist.id().as_str());
    assert_eq!(w.info(&p2).await?["status"], "Offered");
    Ok(())
}

/// The collection accepts terms whose deadline is just past the minimum lead; one block later the
/// piece's own `init` rejects them, so the creation batch fails. The payer gets the deposit back
/// and the token id stays burned (A6). Block timing decides which side of the line we land on,
/// so the deadline is searched until the batch itself fails.
#[tokio::test]
async fn create_piece_failure_refunds_deposit() -> anyhow::Result<()> {
    let w = World::new().await?;
    let cost = w.creation_cost(true).await?;
    let lead = w.time.deadline_min_lead;
    let mut delta: i64 = 1_500_000_000;
    for attempt in 0..30 {
        let mut t = w.terms(true, 10 * USDC, 600).await?;
        let now = w.now().await?;
        t.deadline_ns = near_sdk::json_types::U64((now as i64 + lead as i64 + delta) as u64);
        let next: u64 = w.view(&w.collection, "collection_info", json!({})).await?["next_token_id"].as_str().unwrap().parse()?;
        w.worker.fast_forward(3).await?; // let earlier attempts' refunds land
        let a0 = w.near_balance(w.artist.id()).await?;
        let r = w
            .artist
            .call(&w.collection, "create_piece")
            .args_json(json!({ "kind": common::PieceKind::Commission(t), "capture_pubkey": ed_pk(&w.capture) }))
            .deposit(NearToken::from_yoctonear(cost))
            .gas(Gas::from_tgas(150))
            .transact()
            .await?;
        if !r.is_success() {
            delta += 400_000_000; // the collection already said no: aim later
            continue;
        }
        if r.logs().iter().any(|l| l.contains("piece_created")) {
            delta -= 300_000_000; // both said yes: aim earlier
            continue;
        }
        // The batch failed inside the piece's init.
        assert!(!r.json::<bool>()?, "on_piece_created reports the failure");
        w.worker.fast_forward(3).await?;
        let spent = a0 as i128 - w.near_balance(w.artist.id()).await? as i128;
        // Back to gas only: not the deposit lost, and not refunded twice.
        assert!(spent > 0 && spent < (cost / 4) as i128, "spent {spent} of deposit {cost} on attempt {attempt}");
        let after: u64 = w.view(&w.collection, "collection_info", json!({})).await?["next_token_id"].as_str().unwrap().parse()?;
        assert_eq!(after, next + 1, "id burned, never reused");
        let id: AccountId = w.piece_id(&next.to_string());
        assert!(w.worker.view_account(&id).await.is_err(), "no account left behind");
        assert!(w.view(&w.collection, "nft_token", json!({ "token_id": next.to_string() })).await?.is_null());
        return Ok(());
    }
    anyhow::bail!("never hit the window between the collection's and the piece's validation")
}

#[tokio::test]
async fn caps_capture_keys() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (_, piece, t) = w.commission(true, 10 * USDC).await?;
    ok(w.fund(&piece, &t, &w.client).await?)?;
    fails_with(w.act(&w.artist, &piece, "add_capture_key", json!({ "key": ed_pk(&w.capture) })).await?, "ERR_DUPLICATE_KEY")?;
    for i in 1..4u8 {
        let k = ed25519_dalek::SigningKey::from_bytes(&[100 + i; 32]);
        ok(w.act(&w.artist, &piece, "add_capture_key", json!({ "key": ed_pk(&k) })).await?)?;
    }
    let k = ed25519_dalek::SigningKey::from_bytes(&[200; 32]);
    fails_with(w.act(&w.artist, &piece, "add_capture_key", json!({ "key": ed_pk(&k) })).await?, "ERR_TOO_MANY_KEYS")?;
    Ok(())
}

#[tokio::test]
async fn caps_invites() -> anyhow::Result<()> {
    let w = World::new().await?;
    let (_, piece, t) = w.commission(true, 10 * USDC).await?;
    ok(w.fund(&piece, &t, &w.client).await?)?;
    let inv = |i: u32| -> AccountId { format!("inv{i}.{}", w.root.id()).parse().unwrap() };
    for i in 0..16 {
        ok(w.act(&w.artist, &piece, "invite_challenger", json!({ "account": inv(i) })).await?)?;
    }
    fails_with(w.act(&w.artist, &piece, "invite_challenger", json!({ "account": inv(0) })).await?, "ERR_ALREADY_INVITED")?;
    fails_with(w.act(&w.artist, &piece, "invite_challenger", json!({ "account": inv(16) })).await?, "ERR_TOO_MANY_INVITES")?;
    assert_eq!(w.view(&piece, "proof_page", json!({ "from": 0, "limit": 0 })).await?["invites"].as_array().unwrap().len(), 16);
    Ok(())
}

#[tokio::test]
async fn caps_challenges_per_issuer() -> anyhow::Result<()> {
    let w = World::new().await?;
    let t = w.terms(true, 10 * USDC, 3600).await?;
    let id = w.create(common::PieceKind::Commission(t.clone())).await?;
    let piece = w.piece_id(&id);
    ok(w.fund(&piece, &t, &w.client).await?)?;
    let issue = |n: u8| w.act(&w.client, &piece, "issue_challenge", json!({ "nonce_hash": common::Bytes32([n; 32]) }));
    for n in 0..8u8 {
        ok(issue(n).await?)?;
        if n == 0 {
            fails_with(issue(99).await?, "ERR_CHALLENGE_OPEN")?;
        }
        w.sleep(61).await?;
    }
    fails_with(issue(8).await?, "ERR_TOO_MANY_CHALLENGES")?;
    // Non-parties cannot challenge at all.
    fails_with(w.act(&w.buyer, &piece, "issue_challenge", json!({ "nonce_hash": common::Bytes32([1; 32]) })).await?, "ERR_NOT_CHALLENGER")?;
    Ok(())
}

/// MAX_ADDENDA (8) is above the longest possible widening chain (5 steps), so the chain ends on
/// `ERR_ADDENDUM_NOT_WIDER`; the cap itself is unit-tested in the core.
#[tokio::test]
async fn caps_addenda_chain_ends() -> anyhow::Result<()> {
    use common::{Grant, GrantType::*};
    let w = World::new().await?;
    let (_, piece) = w.settled(true, 10 * USDC).await?;
    let steps = [
        Grant { kind: CommercialNonExclusive, attribution: false, transferable: true },
        Grant { kind: CommercialExclusive, attribution: false, transferable: true },
        Grant { kind: FullAssignment, attribution: false, transferable: true },
    ];
    for (i, g) in steps.iter().enumerate() {
        let h = common::Bytes32([i as u8 + 1; 32]);
        ok(w.act(&w.artist, &piece, "propose_addendum", json!({ "grant": g, "text_hash": h })).await?)?;
        fails_with(w.act(&w.client, &piece, "accept_addendum", json!({ "expected_hash": common::Bytes32([0xee; 32]) })).await?, "ERR_ADDENDUM_CHANGED")?;
        ok(w.act(&w.client, &piece, "accept_addendum", json!({ "expected_hash": h })).await?)?;
    }
    fails_with(w.act(&w.artist, &piece, "propose_addendum", json!({ "grant": steps[2], "text_hash": common::Bytes32([9; 32]) })).await?, "ERR_ADDENDUM_NOT_WIDER")?;
    let info = w.info(&piece).await?;
    assert_eq!(info["addenda"].as_array().unwrap().len(), 3);
    assert_eq!(info["grant"]["kind"], "FullAssignment");
    Ok(())
}

#[tokio::test]
async fn views_paginate() -> anyhow::Result<()> {
    let w = World::new().await?;
    for _ in 0..3 {
        w.standalone(false, 500, false).await?;
    }
    let page = w.view(&w.collection, "nft_tokens", json!({ "from_index": "1", "limit": 1 })).await?;
    let page = page.as_array().unwrap();
    assert_eq!(page.len(), 1);
    assert_eq!(page[0]["token_id"], "2");
    let all = w.view(&w.collection, "nft_tokens", json!({})).await?;
    assert_eq!(all.as_array().unwrap().len(), 3);
    let mine = w.view(&w.collection, "nft_tokens_for_owner", json!({ "account_id": w.artist.id(), "from_index": "1", "limit": 5 })).await?;
    assert_eq!(mine.as_array().unwrap().len(), 2);
    assert_eq!(w.view(&w.collection, "nft_supply_for_owner", json!({ "account_id": w.artist.id() })).await?, "3");
    // Piece proof pages.
    let (_, piece, t) = w.commission(true, 10 * USDC).await?;
    ok(w.fund(&piece, &t, &w.client).await?)?;
    for i in 0..3u32 {
        ok(w.act(&w.artist, &piece, "invite_challenger", json!({ "account": format!("inv{i}.{}", w.root.id()) })).await?)?;
    }
    ok(w.act(&w.client, &piece, "issue_challenge", json!({ "nonce_hash": common::Bytes32([1; 32]) })).await?)?;
    // Challenges page; segments (≤ 4) and invites (≤ 16) are bounded and always whole.
    let p = w.view(&piece, "proof_page", json!({ "from": 0, "limit": 1 })).await?;
    assert_eq!(p["challenges"].as_array().unwrap().len(), 1);
    assert_eq!(p["challenges_total"], 1);
    assert_eq!(p["segments"].as_array().unwrap().len(), 1);
    assert_eq!(p["invites"].as_array().unwrap().len(), 3);
    let p = w.view(&piece, "proof_page", json!({ "from": 1, "limit": 10 })).await?;
    assert!(p["challenges"].as_array().unwrap().is_empty());
    assert_eq!(p["challenges_total"], 1);
    Ok(())
}
