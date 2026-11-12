//! `soulprint-deploy` — Plan 1 Task 15 testnet genesis. See `soulprint/docs/testnet-deploy.md`.
//!
//!   soulprint-deploy --owner <id>.testnet [--version v1] [--time fast|production]
//!       [--collection-free-near 1] [--usdc <existing token>] [--demo-accounts] [--smoke] [--skip-publish]
//!       [--governance <id>] [--config ../config/networks.json] [--state PATH] [--plan]
//!   soulprint-deploy --dry-run-sandbox [--hold --config PATH]
//!       same path against a throwaway local sandbox. --hold keeps the sandbox up and writes its
//!       entry under "testnet" in PATH, so scripts/testnet-stack.sh can exercise testnet mode locally.
//!
//! Owner key: env OWNER_SECRET_KEY (ed25519:…) or --key-file (near credentials JSON), default
//! ~/.near-credentials/testnet/<owner>.json.
use anyhow::{bail, Context, Result};
use near_workspaces::{Account, AccountId};
use soulprint_deploy::*;
use std::path::PathBuf;

struct Cli {
    owner: Option<String>,
    key_file: Option<PathBuf>,
    config: PathBuf,
    state: Option<PathBuf>,
    plan: bool,
    dry_run: bool,
    hold: bool,
    o: Options,
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| ".".into())
}

fn parse() -> Result<Cli> {
    let mut c = Cli {
        owner: None,
        key_file: None,
        config: "../config/networks.json".into(),
        state: None,
        plan: false,
        dry_run: false,
        hold: false,
        o: Options {
            version: "v1".into(),
            governance: None,
            time_name: "fast".into(),
            collection_free: NEAR,
            usdc: None,
            demo_accounts: false,
            skip_publish: false,
            smoke: false,
            network_id: "testnet".into(),
            rpc_url: "https://rpc.testnet.near.org".into(),
        },
    };
    let mut a = std::env::args().skip(1);
    while let Some(f) = a.next() {
        let mut val = || a.next().with_context(|| format!("{f} needs a value"));
        match f.as_str() {
            "--owner" => c.owner = Some(val()?),
            "--key-file" => c.key_file = Some(val()?.into()),
            "--version" => c.o.version = val()?,
            "--time" => c.o.time_name = val()?,
            "--collection-free-near" => c.o.collection_free = (val()?.parse::<f64>()? * 1e6) as u128 * 10u128.pow(18),
            "--usdc" => c.o.usdc = Some(val()?.parse()?),
            "--governance" => c.o.governance = Some(val()?.parse()?),
            "--rpc" => c.o.rpc_url = val()?,
            "--config" => c.config = val()?.into(),
            "--state" => c.state = Some(val()?.into()),
            "--demo-accounts" => c.o.demo_accounts = true,
            "--smoke" => c.o.smoke = true,
            "--skip-publish" => c.o.skip_publish = true,
            "--plan" => c.plan = true,
            "--dry-run-sandbox" => c.dry_run = true,
            "--hold" => c.hold = true,
            "-h" | "--help" => {
                println!("{}", include_str!("main.rs").lines().take_while(|l| l.starts_with("//!")).map(|l| l.trim_start_matches("//!")).collect::<Vec<_>>().join("\n"));
                std::process::exit(0);
            }
            other => bail!("unknown argument {other} (try --help)"),
        }
    }
    c.o.time()?;
    Ok(c)
}

fn print_plan(owner: &str, o: &Options, w: &Wasms) {
    println!("Deploy plan for owner {owner} (collection soulprint-{}.{owner}, time preset {}):", o.version, o.time_name);
    let lines = budget(owner, o, w);
    for l in &lines {
        println!("  {:<22} {:>14}  {:<48} {}", l.role, fmt_near(l.near), l.account, l.why);
    }
    let total: u128 = lines.iter().map(|l| l.near).sum::<u128>() + FEE_MARGIN;
    println!("  {:<22} {:>14}", "fees margin", fmt_near(FEE_MARGIN));
    println!("  {:<22} {:>14}", "TOTAL owner needs", fmt_near(total));
}

#[tokio::main]
async fn main() -> Result<()> {
    let c = parse()?;
    let w = Wasms::load();
    let log = |m: &str| eprintln!("[deploy] {m}");

    if c.dry_run {
        let (d, dir, worker) = dry_run_sandbox(c.o.clone(), &log).await?;
        println!("{}", serde_json::to_string_pretty(&d.entry)?);
        println!("DRY RUN OK — files in {}", dir.display());
        if c.hold {
            write_network_entry(&c.config, "testnet", d.entry.clone())?;
            println!("HOLD {} config={} env={}", d.entry["rpc_url"], c.config.display(), dir.join("services.env").display());
            tokio::signal::ctrl_c().await?;
            drop(worker);
        }
        return Ok(());
    }

    let owner_id: AccountId = c.owner.clone().context("--owner is required (or --dry-run-sandbox)")?.parse()?;
    if c.plan {
        print_plan(owner_id.as_str(), &c.o, &w);
        return Ok(());
    }
    let worker = near_workspaces::testnet().rpc_addr(&c.o.rpc_url).await?;
    let owner = match std::env::var("OWNER_SECRET_KEY") {
        Ok(k) => Account::from_secret_key(owner_id.clone(), k.parse().map_err(|e| anyhow::anyhow!("OWNER_SECRET_KEY: {e:?}"))?, &worker),
        Err(_) => {
            // near-cli-rs legacy keychain ({private_key, …}) or near-api-js ({account_id, secret_key}).
            let f = c.key_file.clone().unwrap_or_else(|| home().join(".near-credentials/testnet").join(format!("{owner_id}.json")));
            let j: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&f).with_context(|| format!("no OWNER_SECRET_KEY and cannot read {}", f.display()))?)?;
            let k = j["private_key"].as_str().or(j["secret_key"].as_str()).with_context(|| format!("{}: no private_key/secret_key", f.display()))?;
            Account::from_secret_key(owner_id.clone(), k.parse().map_err(|e| anyhow::anyhow!("{}: {e:?}", f.display()))?, &worker)
        }
    };
    let collection = format!("soulprint-{}.{owner_id}", c.o.version);
    let dir = home().join(".soulprint/testnet");
    let state_path = c.state.clone().unwrap_or_else(|| dir.join(format!("{collection}.state.json")));
    let st = State::load(&state_path)?.unwrap_or_default();
    print_plan(owner_id.as_str(), &c.o, &w);
    eprintln!("[deploy] state file (holds keys): {}", state_path.display());
    let save = |s: &State| s.save(&state_path);
    let d = deploy(&worker, &owner, &c.o, &w, st, &save, &log).await?;
    write_network_entry(&c.config, "testnet", d.entry.clone())?;
    let env_path = dir.join(format!("{collection}.services.env"));
    std::fs::write(&env_path, services_env(&d.entry, &d.state))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&env_path, std::fs::Permissions::from_mode(0o600))?;
    }
    println!("{}", serde_json::to_string_pretty(&d.entry)?);
    println!("DEPLOYED {collection}\n  genesis tx {}\n  config     {}\n  services   source {}", d.state.genesis_tx, c.config.display(), env_path.display());
    Ok(())
}
