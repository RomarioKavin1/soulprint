//! `soulprint-sandbox` (A39): a long-running local chain for the web app and E2E.
//! Boots near-sandbox, publishes the global piece code, waits for distribution, creates the
//! collection keylessly, deploys test USDC (6 decimals), funds demo accounts, writes the
//! `sandbox` entry of `config/networks.json` (other networks are kept), and stays up until SIGINT.
//!
//! Usage: soulprint-sandbox [--config PATH]   (default: config/networks.json)
//! Keys written are throwaway local-sandbox keys; never reuse them on a public network.
use anyhow::{Context, Result};
use serde_json::{json, Map, Value};
use tests::World;

fn config_path() -> Result<std::path::PathBuf> {
    let mut args = std::env::args().skip(1);
    let mut path = std::path::PathBuf::from("config/networks.json");
    while let Some(a) = args.next() {
        match a.as_str() {
            "--config" => path = args.next().context("--config needs a path")?.into(),
            "-h" | "--help" => {
                println!("soulprint-sandbox [--config PATH]");
                std::process::exit(0);
            }
            other => anyhow::bail!("unknown argument {other}"),
        }
    }
    Ok(path)
}

fn account(a: &near_workspaces::Account) -> Value {
    json!({ "account_id": a.id(), "secret_key": a.secret_key().to_string() })
}

#[tokio::main]
async fn main() -> Result<()> {
    let path = config_path()?;
    eprintln!("soulprint-sandbox: booting (this takes ~15 s)…");
    let w = World::new().await?;
    let info: Value = w.view(&w.collection, "collection_info", json!({})).await?;
    let sandbox = json!({
        "network_id": "sandbox",
        "rpc_url": w.worker.rpc_addr(),
        "collection": w.collection,
        "governance": w.gov.id(),
        "currency_token": w.usdc.id(),
        "currency_decimals": 6,
        "evil_receiver": w.evil.id(),
        "piece_code_hash": info["piece_code_hash"],
        "time": info["time"],
        "currencies": info["currencies"],
        "start_block": w.worker.view_block().await?.height(),
        "capture_test_key": hex_seed(&w.capture),
        "accounts": {
            "governance": account(&w.gov),
            "relayer": account(&w.svc),
            "artist": account(&w.artist),
            "client": account(&w.client),
            "buyer": account(&w.buyer),
            "buyer2": account(&w.buyer2),
            "shop": account(&w.shop),
            "arbitrator": account(&w.arb),
            "fallback_arbitrator": account(&w.fallback),
        },
    });
    let mut all: Map<String, Value> = match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).with_context(|| format!("{} is not JSON", path.display()))?,
        Err(_) => Map::new(),
    };
    all.insert("sandbox".into(), sandbox);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // Write-then-rename so readers never see a half-written file.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&Value::Object(all))? + "\n")?;
    std::fs::rename(&tmp, &path)?;
    println!("READY {} collection={} config={}", w.worker.rpc_addr(), w.collection, path.display());
    tokio::signal::ctrl_c().await?;
    eprintln!("soulprint-sandbox: stopping");
    drop(w); // stops the node
    Ok(())
}

/// The demo capture key's 32-byte seed, hex (Plan 2's capture app can load it in sandbox mode).
fn hex_seed(k: &ed25519_dalek::SigningKey) -> String {
    k.to_bytes().iter().map(|b| format!("{b:02x}")).collect()
}
