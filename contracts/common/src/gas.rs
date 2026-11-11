//! Static gas constants (Tgas). Callback budgets are measured with every vector at its cap (A17);
//! values here are upper bounds verified by the sandbox tests `callbacks_succeed_at_min_gas` and
//! `callbacks_succeed_at_min_gas_with_state_at_caps` (6.7 KB state, 64-character ids).
use near_sdk::Gas;

pub const NEAR_TRANSFER_CALLBACK: Gas = Gas::from_tgas(10);
pub const FT_TRANSFER: Gas = Gas::from_tgas(15);
pub const FT_TRANSFER_CALLBACK: Gas = Gas::from_tgas(10);
pub const FT_STORAGE_DEPOSIT: Gas = Gas::from_tgas(10);
/// claim()/claim_to()/withdraw() on an FT piece.
pub const MIN_CLAIM_FT: Gas = Gas::from_tgas(40);
pub const MIN_CLAIM_NEAR: Gas = Gas::from_tgas(25);
pub const NOTIFY_COLLECTION: Gas = Gas::from_tgas(10);
pub const PIECE_INIT: Gas = Gas::from_tgas(30);
pub const ON_PIECE_CREATED: Gas = Gas::from_tgas(15);
pub const ROTATE_OWNER: Gas = Gas::from_tgas(20);
pub const ON_ROTATE_RESOLVED: Gas = Gas::from_tgas(15);
pub const NFT_ON_TRANSFER: Gas = Gas::from_tgas(35);
pub const NFT_RESOLVE_TRANSFER: Gas = Gas::from_tgas(50);
pub const RESOLVE_TRANSFER: Gas = Gas::from_tgas(20);
pub const MIN_TRANSFER_CALL: Gas = Gas::from_tgas(200);
pub const RECORD_ATTESTATION: Gas = Gas::from_tgas(15);
pub const READ_PIECE_OWNER: Gas = Gas::from_tgas(10);
pub const ON_SYNC: Gas = Gas::from_tgas(10);
