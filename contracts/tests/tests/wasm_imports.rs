//! A8: the piece wasm imports none of the host functions that could deploy code or manage keys.
//! Reads `contracts/res/piece.wasm` produced by `scripts/build.sh`.
use wasmparser::{Parser, Payload};

fn imports(path: &str) -> Vec<String> {
    let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("{path}: {e} (run scripts/build.sh first)"));
    let mut out = vec![];
    for payload in Parser::new(0).parse_all(&bytes) {
        if let Payload::ImportSection(reader) = payload.unwrap() {
            for imp in reader {
                let imp = imp.unwrap();
                out.push(format!("{}::{}", imp.module, imp.name));
            }
        }
    }
    out
}

#[test]
fn piece_wasm_imports_no_admin_host_fns() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../res/piece.wasm");
    let got = imports(path);
    assert!(got.iter().any(|i| i.ends_with("::storage_write")), "sanity: imports parsed: {got:?}");
    for banned in [
        "promise_batch_action_deploy_contract",
        "promise_batch_action_deploy_global_contract",
        "promise_batch_action_deploy_global_contract_by_account_id",
        "promise_batch_action_use_global_contract",
        "promise_batch_action_use_global_contract_by_account_id",
        "promise_batch_action_add_key_with_full_access",
        "promise_batch_action_add_key_with_function_call",
        "promise_batch_action_delete_key",
        "promise_batch_action_delete_account",
    ] {
        assert!(!got.iter().any(|i| i.ends_with(&format!("::{banned}"))), "piece imports {banned}");
    }
}
