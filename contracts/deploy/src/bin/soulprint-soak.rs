//! `soulprint-soak` — Plan 1 Task 15 soak on a deployed `fast` collection, using the demo
//! accounts from the deploy state file.
//!
//!   soulprint-soak --state ~/.soulprint/testnet/<collection>.state.json [--n 20] [--minutes 60]
//!       [--rpc https://rpc.testnet.near.org]
//!   soulprint-soak --dry-run-sandbox [--n 6]     deploy on a throwaway sandbox, then soak it
//!
//! Each lifecycle is reconciled on chain as it ends and again at the end; then run the indexer
//! reconciliation: SOULPRINT_NETWORK=testnet SOULPRINT_CONFIG=config/networks.json
//! pnpm -C services/indexer exec vitest run test/live.test.ts
use anyhow::{Context, Result};
use soulprint_deploy::soak::{soak, Soak};
use soulprint_deploy::*;

#[tokio::main]
async fn main() -> Result<()> {
    let (mut state, mut n, mut minutes, mut rpc, mut dry) = (None::<std::path::PathBuf>, 20usize, 60u64, "https://rpc.testnet.near.org".to_string(), false);
    let mut a = std::env::args().skip(1);
    while let Some(f) = a.next() {
        let mut val = || a.next().with_context(|| format!("{f} needs a value"));
        match f.as_str() {
            "--state" => state = Some(val()?.into()),
            "--n" => n = val()?.parse()?,
            "--minutes" => minutes = val()?.parse()?,
            "--rpc" => rpc = val()?,
            "--dry-run-sandbox" => dry = true,
            "-h" | "--help" => {
                println!("{}", include_str!("soulprint-soak.rs").lines().take_while(|l| l.starts_with("//!")).map(|l| l.trim_start_matches("//!")).collect::<Vec<_>>().join("\n"));
                return Ok(());
            }
            other => anyhow::bail!("unknown argument {other}"),
        }
    }
    let log = |m: &str| eprintln!("[soak] {m}");
    let done = if dry {
        let (d, _dir, worker) = dry_run_sandbox(default_options(), &|m| eprintln!("[deploy] {m}")).await?;
        let s = Soak::from_state(&worker, &d.state, &log)?;
        soak(&s, n, minutes * 60).await?
    } else {
        let path = state.context("--state is required (or --dry-run-sandbox)")?;
        let st = State::load(&path)?.with_context(|| format!("no state at {}", path.display()))?;
        let worker = near_workspaces::testnet().rpc_addr(&rpc).await?;
        let s = Soak::from_state(&worker, &st, &log)?;
        soak(&s, n, minutes * 60).await?
    };
    for (sc, p) in &done {
        println!("{sc:?}\t{p}");
    }
    println!("SOAK OK — {} lifecycles reconciled", done.len());
    Ok(())
}
