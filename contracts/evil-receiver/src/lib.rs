//! Test-only NFT receiver for `nft_transfer_call` attacks (T9). Behaviour chosen by `msg`:
//! "keep" → false; "return" → true; "drain" → try owner actions on the piece, then true;
//! "huge" → a ~4 MiB return value; "gas" → burn all gas; "panic" → panic.
use near_sdk::serde_json::Value;
use near_sdk::{env, near, AccountId, Gas, NearToken, Promise};

#[near(contract_state)]
#[derive(Default)]
pub struct Evil {}

#[near]
impl Evil {
    pub fn nft_on_transfer(&mut self, sender_id: AccountId, previous_owner_id: AccountId, token_id: String, msg: String) -> Value {
        let _ = (sender_id, previous_owner_id);
        match msg.as_str() {
            "keep" => Value::Bool(false),
            "return" => Value::Bool(true),
            "drain" => {
                let piece: AccountId = format!("p{token_id}.{}", env::predecessor_account_id()).parse().unwrap();
                for (m, args) in [("withdraw", "{}"), ("list", r#"{"price":"1000000"}"#), ("delist", "{}")] {
                    Promise::new(piece.clone())
                        .function_call(m, args.as_bytes().to_vec(), NearToken::from_yoctonear(1), Gas::from_tgas(10))
                        .detach();
                }
                Value::Bool(true)
            }
            // A JSON string just under 4 MiB: far over the collection's 16-byte read bound.
            "huge" => Value::String(" ".repeat(4 * 1024 * 1024 - 64)),
            "gas" => {
                let mut x = 0u64;
                loop {
                    x = x.wrapping_add(env::block_height());
                    if x == 7 {
                        break Value::Bool(false);
                    }
                }
            }
            _ => env::panic_str("evil panic"),
        }
    }
}
