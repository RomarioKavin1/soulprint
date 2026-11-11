//! Cross-language check (Plan 2 Task 6): the evidence service (TypeScript) signs a report; the
//! collection verifies it and the piece records it. Fixture written by services/evidence/test/report.test.ts.
use serde_json::{json, Value};
use tests::*;

fn fixture() -> Value {
    serde_json::from_str(include_str!("../fixtures/ts-report-e2.json")).unwrap()
}

/// First piece of a fresh World (`p1`), funded, anchored with the TS capture signature, delivered.
async fn delivered(w: &World, f: &Value) -> anyhow::Result<near_workspaces::AccountId> {
    let (id, piece, t) = w.commission(true, 100_000_000).await?;
    assert_eq!(id, "1", "fixture is signed for token 1");
    ok(w.fund(&piece, &t, &w.client).await?)?;
    let a = &f["anchor"];
    ok(w.artist
        .call(&piece, "anchor")
        .args_json(json!({ "key": a["key"], "head": a["head"], "count": a["count"], "sig": a["sig"] }))
        .max_gas()
        .transact()
        .await?)?;
    ok(w.act(&w.artist, &piece, "deliver", json!({ "final_file_hash": f["final_file_hash"], "report_hash": f["report_hash"] })).await?)?;
    Ok(piece)
}

async fn attest(w: &World, args: &str) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(w.svc.call(&w.collection, "attest").args(args.as_bytes().to_vec()).max_gas().transact().await?)
}

#[tokio::test]
async fn attest_accepts_service_signature() -> anyhow::Result<()> {
    let w = World::new().await?;
    let f = fixture();
    let piece = delivered(&w, &f).await?;
    ok(attest(&w, f["attest_args_json"].as_str().unwrap()).await?)?;
    let proof = w.view(&piece, "proof_page", json!({ "from": 0, "limit": 1 })).await?;
    assert_eq!(proof["attestation"]["evidence_level"], 2);
    assert_eq!(proof["attestation"]["key_id"], 1);
    assert_eq!(proof["attestation"]["report_hash"], f["report_hash"]);
    assert_eq!(proof["attestation"]["issued_at"], "1800000000000000000");
    let info = w.view(&piece, "piece_info", json!({})).await?;
    assert_eq!(info["evidence_level"], 2);
    Ok(())
}

#[tokio::test]
async fn attest_rejects_level_tamper() -> anyhow::Result<()> {
    let w = World::new().await?;
    let f = fixture();
    let piece = delivered(&w, &f).await?;
    let args = f["attest_args_json"].as_str().unwrap();
    assert!(args.contains("\"evidence_level\":2"));
    fails_with(attest(&w, &args.replace("\"evidence_level\":2", "\"evidence_level\":3")).await?, "ERR_BAD_SIGNATURE")?;
    let info = w.view(&piece, "piece_info", json!({})).await?;
    assert_eq!(info["evidence_level"], 0);
    Ok(())
}
