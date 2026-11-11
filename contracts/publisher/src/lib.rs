//! Test/deploy helper: publishes the call's raw input as a global contract identified by code hash
//! (NEP-591). The publishing account pays the burn (10× code storage) from its balance.

#[cfg(target_arch = "wasm32")]
#[unsafe(no_mangle)]
pub extern "C" fn publish() {
    use near_sdk::env;
    env::setup_panic_hook();
    let code = env::input().unwrap_or_else(|| env::panic_str("ERR_NO_CODE"));
    let p = env::promise_batch_create(&env::current_account_id());
    env::promise_batch_action_deploy_global_contract(p, &code);
    let h = env::sha256_array(&code);
    env::value_return(&h);
}
