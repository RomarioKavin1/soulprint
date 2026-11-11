//! Spawns the real binary, waits for its config, reads views through its RPC, stops it with SIGINT.
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[tokio::test]
async fn sandbox_bin_writes_config_and_serves_views() -> anyhow::Result<()> {
    let dir = std::env::temp_dir().join(format!("soulprint-sandbox-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    let cfg = dir.join("networks.json");
    // An existing testnet entry must survive the rewrite.
    std::fs::write(&cfg, r#"{"testnet":{"network_id":"testnet","keep":"me"}}"#)?;
    let mut child = Command::new(env!("CARGO_BIN_EXE_soulprint-sandbox"))
        .args(["--config", cfg.to_str().unwrap()])
        .stdout(Stdio::piped())
        .spawn()?;
    let start = Instant::now();
    let net = loop {
        if let Ok(s) = std::fs::read_to_string(&cfg) {
            let v: serde_json::Value = serde_json::from_str(&s)?;
            if v.get("sandbox").is_some() {
                break v;
            }
        }
        assert!(start.elapsed() < Duration::from_secs(180), "no config written");
        assert!(child.try_wait()?.is_none(), "binary exited early");
        tokio::time::sleep(Duration::from_millis(500)).await;
    };
    assert_eq!(net["testnet"]["keep"], "me");
    let sb = &net["sandbox"];
    for k in ["rpc_url", "collection", "currency_token", "governance", "piece_code_hash"] {
        assert!(sb[k].is_string(), "missing {k}: {sb}");
    }
    for who in ["artist", "client", "buyer", "arbitrator", "fallback_arbitrator", "shop"] {
        assert!(sb["accounts"][who]["secret_key"].as_str().unwrap().starts_with("ed25519:"), "{who}");
    }
    let worker = near_workspaces::custom(sb["rpc_url"].as_str().unwrap()).await?;
    let collection: near_workspaces::AccountId = sb["collection"].as_str().unwrap().parse()?;
    let meta: serde_json::Value = worker.view(&collection, "nft_metadata").await?.json()?;
    assert_eq!(meta["spec"], "nft-1.0.0");
    // Demo accounts hold test USDC.
    let usdc: near_workspaces::AccountId = sb["currency_token"].as_str().unwrap().parse()?;
    let bal: String = worker.view(&usdc, "ft_balance_of").args_json(serde_json::json!({ "account_id": sb["accounts"]["client"]["account_id"] })).await?.json()?;
    assert!(bal.parse::<u128>()? > 0);
    // SIGINT shuts it down cleanly (and with it the node it started).
    Command::new("kill").args(["-INT", &child.id().to_string()]).status()?;
    let start = Instant::now();
    while child.try_wait()?.is_none() {
        assert!(start.elapsed() < Duration::from_secs(30), "did not stop on SIGINT");
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Ok(())
}
