//! Plan 1 Task 15: the testnet deploy path, run on a local sandbox.
use serde_json::Value;
use soulprint_deploy::*;

fn opts() -> Options {
    Options {
        version: "v1".into(),
        governance: None,
        time_name: "fast".into(),
        collection_free: NEAR,
        usdc: None,
        demo_accounts: true,
        skip_publish: false,
        smoke: true,
        network_id: String::new(),
        rpc_url: String::new(),
    }
}

#[tokio::test]
async fn testnet_genesis_dry_run_is_keyless_resumable_and_writes_config() -> anyhow::Result<()> {
    let (d, dir, _worker) = dry_run_sandbox(opts(), &|m| eprintln!("{m}")).await?;
    // deploy() itself bails unless the collection has zero keys and the built code; the smoke
    // piece is keyless. Here: the outputs the services and web read.
    let cfg: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("networks.json"))?)?;
    let e = &cfg["sandbox"];
    assert_eq!(e["collection"], "soulprint-v1.owner.test.near");
    assert_eq!(e["piece_code_sha256"].as_str().unwrap(), hex::encode(sha256(&Wasms::load().piece)));
    assert!(!e["genesis_tx"].as_str().unwrap().is_empty());
    assert!(e.to_string().find("ed25519:").is_none(), "networks.json must not carry secret keys");
    assert!(d.state.is_done_all(&["publish", "usdc", "create:collection", "smoke"]));
    let env = std::fs::read_to_string(dir.join("services.env"))?;
    for k in ["EVIDENCE_SECRET_KEY", "RELAYER_SECRET_KEY", "EVIDENCE_VERIFIER_SEED", "EVIDENCE_MASTER_KEY", "MIN_INCOME_JSON"] {
        assert!(env.contains(&format!("export {k}='")), "{k} missing");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(dir.join("state.json"))?.permissions().mode() & 0o777, 0o600);
    }
    Ok(())
}

#[test]
fn budget_covers_the_global_burn_and_collection_free_balance() {
    let w = Wasms::load();
    let b = budget("o.testnet", &opts(), &w);
    let publisher = b.iter().find(|l| l.role == "publisher").unwrap();
    assert!(publisher.near >= GLOBAL_FACTOR * w.piece.len() as u128 * BYTE + NEAR, "1 NEAR over the burn");
    let collection = b.iter().find(|l| l.role == "collection").unwrap();
    assert!(collection.near >= w.collection.len() as u128 * BYTE + NEAR);
    assert_eq!(collection.account, "soulprint-v1.o.testnet");
    let skip = budget("o.testnet", &Options { skip_publish: true, ..opts() }, &w);
    assert!(skip.iter().all(|l| l.role != "publisher"), "--skip-publish drops the 40 NEAR burn");
}

/// Task 15 soak, shortened: every scenario once on a fresh dry-run deploy, each reconciled on chain.
#[tokio::test]
async fn soak_every_scenario_reconciles_on_sandbox() -> anyhow::Result<()> {
    use soulprint_deploy::soak::{soak, Soak, ALL};
    let (d, _dir, worker) = dry_run_sandbox(opts(), &|_| {}).await?;
    let s = Soak::from_state(&worker, &d.state, &|m| eprintln!("{m}"))?;
    let done = soak(&s, ALL.len(), 0).await?;
    for sc in ALL {
        assert!(done.iter().any(|(x, _)| *x == sc), "{sc:?} not run");
    }
    Ok(())
}
