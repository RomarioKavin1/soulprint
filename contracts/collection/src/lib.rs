//! Soulprint collection: keyless, immutable NEP-171 index and piece factory (A5).
//! Ownership truth lives in each piece; this contract only indexes it, ordered by `seq`.
//! Governance can only manage verifier keys (A7). No upgrade method exists.

use common::*;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PublicKey,
};
use std::collections::HashMap;

include!(concat!(env!("OUT_DIR"), "/piece_code_hash.rs"));

/// NEAR left in the new piece account for its state and growth headroom.
pub const PIECE_ACCOUNT_DEPOSIT: u128 = 60_000_000_000_000_000_000_000; // 0.06 NEAR
/// Kept by the collection: index entry + owner-count entries for 8 owner changes (A51).
pub const COLLECTION_RESERVE: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR
/// NEP-145 registration of the piece on its FT currency.
pub const FT_REGISTRATION: u128 = 1_250_000_000_000_000_000_000; // 0.00125 NEAR
pub const MAX_ACTIVE_KEYS: usize = 8;
pub const MAX_REVOKED_KEYS: usize = 64;
/// Receiver results longer than this are treated as "return the token" (A1).
pub const MAX_RECEIVER_RESULT: usize = 16;

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Tokens,
    OwnerCount,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct TokenEntry {
    pub owner: AccountId,
    pub seq: u64,
    pub artist: AccountId,
    pub created_at: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct VerifierKey {
    pub id: u16,
    pub public_key: PublicKey,
    pub activates_at: U64,
    pub revoked_at: Option<U64>,
}

#[near(serializers = [json])]
pub struct Token {
    pub token_id: String,
    pub owner_id: AccountId,
    pub metadata: Option<TokenMetadata>,
    pub approved_account_ids: Option<HashMap<AccountId, u64>>,
}

#[near(serializers = [json])]
pub struct TokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub extra: Option<String>,
}

#[near(serializers = [json])]
pub struct ContractMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[near(serializers = [json])]
pub struct CollectionInfo {
    pub governance: AccountId,
    pub network: String,
    pub piece_code_hash: Bytes32,
    pub next_token_id: U64,
    pub time: TimeConfig,
    pub currencies: Vec<CurrencyConfig>,
}

/// Passed from `create_piece` to its callback.
#[near(serializers = [json])]
pub struct Created {
    pub mode: String,
    pub currency: Currency,
    pub terms_hash: Option<Bytes32>,
    pub ft_registration: U128,
}

/// Piece's `owner_info()` / `rotate_owner()` result.
#[near(serializers = [json])]
pub struct OwnerView {
    pub token_id: String,
    pub owner: AccountId,
    pub seq: U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Collection {
    governance: AccountId,
    network: String,
    time: TimeConfig,
    currencies: Vec<CurrencyConfig>,
    next_id: u64,
    tokens: IterableMap<String, TokenEntry>,
    owner_count: LookupMap<AccountId, u32>,
    keys: Vec<VerifierKey>,
    revoked: Vec<VerifierKey>,
    key_seq: u16,
}

fn nep171(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "nep171", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

/// Explicit form of `#[private]` (A4), also enforced when methods are called directly in tests.
fn only_self() {
    require!(env::predecessor_account_id() == env::current_account_id(), "ERR_PRIVATE: method is private");
}

fn send_near(to: &AccountId, amount: u128) {
    if amount > 0 {
        Promise::new(to.clone()).transfer(NearToken::from_yoctonear(amount)).detach();
    }
}

#[near]
impl Collection {
    /// A5: deployed in one keyless transaction by the parent. Initial keys are active at genesis.
    #[init]
    pub fn new(
        governance: AccountId,
        currencies: Vec<CurrencyConfig>,
        network: String,
        time: TimeConfig,
        initial_verifier_keys: Vec<PublicKey>,
    ) -> Self {
        require!(initial_verifier_keys.len() <= MAX_ACTIVE_KEYS, "ERR_TOO_MANY_KEYS");
        let now = env::block_timestamp();
        let keys: Vec<VerifierKey> = initial_verifier_keys
            .into_iter()
            .enumerate()
            .map(|(i, pk)| {
                require!(ed25519_raw(&pk).is_some(), "ERR_KEY_NOT_ED25519");
                VerifierKey { id: i as u16 + 1, public_key: pk, activates_at: U64(now), revoked_at: None }
            })
            .collect();
        Self {
            governance,
            network,
            time,
            currencies,
            next_id: 1,
            tokens: IterableMap::new(Key::Tokens),
            owner_count: LookupMap::new(Key::OwnerCount),
            key_seq: keys.len() as u16,
            keys,
            revoked: vec![],
        }
    }

    // ---------------- factory ----------------

    pub fn piece_creation_cost(&self, currency: Currency) -> U128 {
        let ft = matches!(currency, Currency::Ft(_));
        U128(PIECE_ACCOUNT_DEPOSIT + COLLECTION_RESERVE + if ft { FT_REGISTRATION } else { 0 })
    }

    /// Artist = predecessor (A6, N17). Creates `p<N>.<self>` from the global piece code.
    #[payable]
    pub fn create_piece(&mut self, kind: PieceKind, capture_pubkey: PublicKey) -> Promise {
        let artist = env::predecessor_account_id();
        let deposit = env::attached_deposit().as_yoctonear();
        let currency = match &kind {
            PieceKind::Commission(t) => t.currency.clone(),
            PieceKind::Standalone(s) => s.currency.clone(),
        };
        let cur = self.currencies.iter().find(|c| c.currency == currency).cloned().unwrap_or_else(|| env::panic_str("ERR_CURRENCY"));
        let cost = self.piece_creation_cost(currency.clone()).0;
        require!(deposit >= cost, "ERR_DEPOSIT");
        require!(ed25519_raw(&capture_pubkey).is_some(), "ERR_KEY_NOT_ED25519");
        let now = env::block_timestamp();
        let valid = match &kind {
            PieceKind::Commission(t) => t.validate(&artist, now, &self.time, &cur),
            PieceKind::Standalone(s) => s.validate(&cur),
        };
        if let Err(e) = valid {
            env::panic_str(&format!("ERR_TERMS_{e:?}"));
        }
        let n = self.next_id;
        self.next_id += 1; // A6: burned on failure, never reused
        let token_id = n.to_string();
        let piece = piece_account(&token_id, &env::current_account_id());
        let ft_reg = if matches!(currency, Currency::Ft(_)) { FT_REGISTRATION } else { 0 };
        let (mode, terms_hash) = match &kind {
            PieceKind::Commission(t) => ("commission".to_string(), Some(t.hash())),
            PieceKind::Standalone(_) => ("standalone".to_string(), None),
        };
        let to_piece = deposit - COLLECTION_RESERVE - ft_reg;
        let init = json!({
            "kind": kind, "artist": artist, "capture_pubkey": capture_pubkey,
            "time": self.time, "currency": cur,
        });
        Promise::new(piece)
            .create_account()
            .transfer(NearToken::from_yoctonear(to_piece))
            .use_global_contract(PIECE_CODE_HASH)
            .function_call("init", serde_json::to_vec(&init).unwrap(), NearToken::from_yoctonear(0), gas::PIECE_INIT)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(gas::ON_PIECE_CREATED.saturating_add(gas::FT_STORAGE_DEPOSIT).saturating_add(gas::ON_PIECE_CREATED))
                    .on_piece_created(token_id, artist.clone(), artist, U128(deposit), Created { mode, currency, terms_hash, ft_registration: U128(ft_reg) }),
            )
    }

    #[private]
    pub fn on_piece_created(&mut self, token_id: String, artist: AccountId, payer: AccountId, deposit: U128, created: Created) -> bool {
        only_self();
        if env::promise_result_checked(0, 0).is_err() {
            // The batch failed: the transfer came back to us; refund the payer. The id stays burned.
            send_near(&payer, deposit.0);
            return false;
        }
        let piece = piece_account(&token_id, &env::current_account_id());
        let now = env::block_timestamp();
        self.tokens.insert(token_id.clone(), TokenEntry { owner: artist.clone(), seq: 0, artist: artist.clone(), created_at: now });
        self.inc_owner(&artist);
        nep171("nft_mint", json!({ "owner_id": artist, "token_ids": [token_id] }));
        SoulprintEvent::PieceCreated {
            piece_id: piece.clone(),
            token_id: token_id.clone(),
            artist,
            mode: created.mode,
            currency: created.currency.clone(),
            terms_hash: created.terms_hash,
        }
        .emit();
        let ft_registration = created.ft_registration;
        if ft_registration.0 > 0 {
            // A19: registration is a separate step; its failure refunds only the registration amount.
            if let Currency::Ft(token) = created.currency {
                Promise::new(token)
                    .function_call(
                        "storage_deposit",
                        serde_json::to_vec(&json!({ "account_id": piece, "registration_only": true })).unwrap(),
                        NearToken::from_yoctonear(ft_registration.0),
                        gas::FT_STORAGE_DEPOSIT,
                    )
                    .then(Self::ext(env::current_account_id()).with_static_gas(gas::ON_SYNC).on_piece_registered(payer, ft_registration))
                    .detach();
            }
        }
        true
    }

    #[private]
    pub fn on_piece_registered(&mut self, payer: AccountId, amount: U128) {
        only_self();
        if env::promise_result_checked(0, 256).is_err() {
            send_near(&payer, amount.0);
        }
    }

    // ---------------- NEP-171 core ----------------

    #[payable]
    pub fn nft_transfer(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>) -> Promise {
        assert_one_yocto();
        require!(approval_id.is_none(), "ERR_NO_APPROVALS");
        let _ = memo;
        self.entry(&token_id);
        let sender = env::predecessor_account_id();
        let piece = piece_account(&token_id, &env::current_account_id());
        Promise::new(piece)
            .function_call(
                "rotate_owner",
                serde_json::to_vec(&json!({ "sender": sender, "receiver": receiver_id, "call": false })).unwrap(),
                NearToken::from_yoctonear(0),
                gas::ROTATE_OWNER,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(gas::ON_ROTATE_RESOLVED).on_rotate_resolved(token_id))
    }

    /// A40: `nft_transfer` callback; panics if the piece refused so the caller sees the failure.
    #[private]
    pub fn on_rotate_resolved(&mut self, token_id: String) {
        only_self();
        let v = Self::read_owner_view().unwrap_or_else(|| env::panic_str("ERR_PIECE_REFUSED"));
        self.apply_owner(&token_id, v.owner, v.seq.0);
    }

    #[payable]
    pub fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> Promise {
        assert_one_yocto();
        require!(approval_id.is_none(), "ERR_NO_APPROVALS");
        require!(env::prepaid_gas() >= gas::MIN_TRANSFER_CALL, "ERR_NOT_ENOUGH_GAS");
        let _ = memo;
        self.entry(&token_id);
        let sender = env::predecessor_account_id();
        let piece = piece_account(&token_id, &env::current_account_id());
        let me = env::current_account_id();
        Promise::new(piece)
            .function_call(
                "rotate_owner",
                serde_json::to_vec(&json!({ "sender": sender, "receiver": receiver_id, "call": true })).unwrap(),
                NearToken::from_yoctonear(0),
                gas::ROTATE_OWNER,
            )
            .then(
                Self::ext(me)
                    .with_static_gas(
                        gas::NFT_ON_TRANSFER
                            .saturating_add(gas::NFT_RESOLVE_TRANSFER)
                            .saturating_add(gas::RESOLVE_TRANSFER)
                            .saturating_add(gas::ON_SYNC)
                            .saturating_add(Gas::from_tgas(15)),
                    )
                    .on_transfer_call_rotated(token_id, sender, receiver_id, msg),
            )
    }

    /// The piece is now in `transfer_pending`; ask the receiver, then resolve.
    #[private]
    pub fn on_transfer_call_rotated(&mut self, token_id: String, previous_owner_id: AccountId, receiver_id: AccountId, msg: String) -> Promise {
        only_self();
        Self::read_owner_view().unwrap_or_else(|| env::panic_str("ERR_PIECE_REFUSED"));
        let me = env::current_account_id();
        Promise::new(receiver_id.clone())
            .function_call(
                "nft_on_transfer",
                serde_json::to_vec(&json!({
                    "sender_id": previous_owner_id, "previous_owner_id": previous_owner_id,
                    "token_id": token_id, "msg": msg,
                }))
                .unwrap(),
                NearToken::from_yoctonear(0),
                gas::NFT_ON_TRANSFER,
            )
            .then(
                Self::ext(me)
                    .with_static_gas(gas::NFT_RESOLVE_TRANSFER)
                    .nft_resolve_transfer(previous_owner_id, receiver_id, token_id, None),
            )
    }

    /// A1: bounded read of the receiver result; anything but exactly `false` reverts. Schedules
    /// `piece.resolve_transfer` first and writes no collection storage in this receipt.
    #[private]
    pub fn nft_resolve_transfer(
        &mut self,
        owner_id: AccountId,
        receiver_id: AccountId,
        token_id: String,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        only_self();
        let _ = (owner_id, receiver_id, approved_account_ids);
        let keep = match env::promise_result_checked(0, MAX_RECEIVER_RESULT) {
            Ok(bytes) => matches!(serde_json::from_slice::<bool>(&bytes), Ok(false)),
            Err(_) => false,
        };
        let piece = piece_account(&token_id, &env::current_account_id());
        Promise::new(piece)
            .function_call(
                "resolve_transfer",
                serde_json::to_vec(&json!({ "revert": !keep })).unwrap(),
                NearToken::from_yoctonear(0),
                gas::RESOLVE_TRANSFER,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(gas::ON_SYNC).on_resolved(token_id))
            .detach();
        keep
    }

    #[private]
    pub fn on_resolved(&mut self, token_id: String) {
        only_self();
        if let Some(v) = Self::read_owner_view() {
            self.apply_owner(&token_id, v.owner, v.seq.0);
        }
    }

    /// A40: piece-initiated owner changes (fund, refund, sale, expiry). Only `p<token_id>.<self>`.
    pub fn on_rotated(&mut self, token_id: String, owner: AccountId, seq: U64) {
        let expected = piece_account(&token_id, &env::current_account_id());
        if env::predecessor_account_id() != expected || !self.tokens.contains_key(&token_id) {
            env::panic_str("ERR_NOT_PIECE");
        }
        self.apply_owner(&token_id, owner, seq.0);
    }

    /// Permissionless repair (T10): read the piece and apply a higher seq.
    pub fn sync_owner(&mut self, token_id: String) -> Promise {
        self.entry(&token_id);
        Promise::new(piece_account(&token_id, &env::current_account_id()))
            .function_call("owner_info", b"{}".to_vec(), NearToken::from_yoctonear(0), gas::READ_PIECE_OWNER)
            .then(Self::ext(env::current_account_id()).with_static_gas(gas::ON_SYNC).on_sync(token_id))
    }

    #[private]
    pub fn on_sync(&mut self, token_id: String) {
        only_self();
        if let Some(v) = Self::read_owner_view() {
            self.apply_owner(&token_id, v.owner, v.seq.0);
        }
    }

    // ---------------- attestation & governance ----------------

    /// Verify the evidence-service signature (A24) and forward the whole message to the piece.
    pub fn attest(&mut self, token_id: String, msg: ReportMessage, sig: Bytes64, key_id: u16) -> Promise {
        require!(self.tokens.contains_key(&token_id), "ERR_NO_TOKEN");
        require!(msg.domain == REPORT_DOMAIN, "ERR_WRONG_DOMAIN");
        require!(msg.network == self.network, "ERR_WRONG_NETWORK");
        let piece = piece_account(&token_id, &env::current_account_id());
        require!(msg.piece_id == piece, "ERR_WRONG_PIECE");
        let now = env::block_timestamp();
        let key = self
            .keys
            .iter()
            .find(|k| k.id == key_id && k.revoked_at.is_none() && k.activates_at.0 <= now)
            .unwrap_or_else(|| env::panic_str("ERR_KEY_INACTIVE"));
        let raw = ed25519_raw(&key.public_key).expect("ed25519");
        require!(env::ed25519_verify(&sig.0, msg.signing_bytes(), &raw.0), "ERR_BAD_SIGNATURE");
        Promise::new(piece).function_call(
            "record_attestation",
            serde_json::to_vec(&json!({ "msg": msg, "key_id": key_id })).unwrap(),
            NearToken::from_yoctonear(0),
            gas::RECORD_ATTESTATION,
        )
    }

    fn require_governance(&self) {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.governance, "ERR_NOT_GOVERNANCE");
    }

    /// A7: new keys activate after `time.key_timelock`; ≤ 8 non-revoked keys.
    #[payable]
    pub fn propose_key(&mut self, public_key: PublicKey) {
        self.require_governance();
        require!(ed25519_raw(&public_key).is_some(), "ERR_KEY_NOT_ED25519");
        require!(self.keys.len() < MAX_ACTIVE_KEYS, "ERR_TOO_MANY_KEYS");
        self.key_seq += 1;
        let activates_at = env::block_timestamp().saturating_add(self.time.key_timelock);
        self.keys.push(VerifierKey { id: self.key_seq, public_key: public_key.clone(), activates_at: U64(activates_at), revoked_at: None });
        SoulprintEvent::KeyProposed { key_id: self.key_seq, public_key, activates_at: U64(activates_at) }.emit();
    }

    /// Anyone, after the timelock: announces activation (validity is time-based either way).
    pub fn activate_key(&mut self, key_id: u16) {
        let k = self.keys.iter().find(|k| k.id == key_id).unwrap_or_else(|| env::panic_str("ERR_NO_KEY"));
        require!(k.activates_at.0 <= env::block_timestamp(), "ERR_KEY_PENDING");
        SoulprintEvent::KeyActivated { key_id }.emit();
    }

    /// Immediate; also cancels a pending proposal.
    #[payable]
    pub fn revoke_key(&mut self, key_id: u16) {
        self.require_governance();
        let i = self.keys.iter().position(|k| k.id == key_id).unwrap_or_else(|| env::panic_str("ERR_NO_KEY"));
        require!(self.revoked.len() < MAX_REVOKED_KEYS, "ERR_TOO_MANY_REVOKED");
        let mut k = self.keys.remove(i);
        k.revoked_at = Some(U64(env::block_timestamp()));
        self.revoked.push(k);
        SoulprintEvent::KeyRevoked { key_id }.emit();
    }

    // ---------------- views ----------------

    pub fn verifier_keys(&self) -> Vec<VerifierKey> {
        self.keys.clone()
    }
    pub fn revoked_keys(&self) -> Vec<VerifierKey> {
        self.revoked.clone()
    }
    pub fn collection_info(&self) -> CollectionInfo {
        CollectionInfo {
            governance: self.governance.clone(),
            network: self.network.clone(),
            piece_code_hash: Bytes32(PIECE_CODE_HASH),
            next_token_id: U64(self.next_id),
            time: self.time,
            currencies: self.currencies.clone(),
        }
    }
    pub fn nft_metadata(&self) -> ContractMetadata {
        ContractMetadata {
            spec: "nft-1.0.0".into(),
            name: "Soulprint".into(),
            symbol: "SOUL".into(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
    pub fn nft_token(&self, token_id: String) -> Option<Token> {
        self.tokens.get(&token_id).map(|e| self.token_view(&token_id, e))
    }
    pub fn nft_total_supply(&self) -> U128 {
        U128(self.tokens.len() as u128)
    }
    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        let from = from_index.map(|f| f.0 as usize).unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100) as usize;
        self.tokens.iter().skip(from).take(limit).map(|(id, e)| self.token_view(id, e)).collect()
    }
    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        U128(self.owner_count.get(&account_id).copied().unwrap_or(0) as u128)
    }
    pub fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        let from = from_index.map(|f| f.0 as usize).unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100) as usize;
        self.tokens
            .iter()
            .filter(|(_, e)| e.owner == account_id)
            .skip(from)
            .take(limit)
            .map(|(id, e)| self.token_view(id, e))
            .collect()
    }
    /// Index seq for a token (for clients comparing with the piece).
    pub fn token_seq(&self, token_id: String) -> Option<U64> {
        self.tokens.get(&token_id).map(|e| U64(e.seq))
    }
}

impl Collection {
    fn entry(&self, token_id: &str) -> &TokenEntry {
        self.tokens.get(token_id).unwrap_or_else(|| env::panic_str("ERR_NO_TOKEN"))
    }

    fn token_view(&self, token_id: &str, e: &TokenEntry) -> Token {
        let piece = piece_account(token_id, &env::current_account_id());
        Token {
            token_id: token_id.to_string(),
            owner_id: e.owner.clone(),
            metadata: Some(TokenMetadata {
                title: Some(format!("Soulprint #{token_id}")),
                description: Some(format!("Artwork account {piece}, by {}", e.artist)),
                extra: Some(json!({ "piece_account": piece, "artist": e.artist }).to_string()),
            }),
            approved_account_ids: Some(HashMap::new()),
        }
    }

    fn inc_owner(&mut self, who: &AccountId) {
        let c = self.owner_count.get(who).copied().unwrap_or(0);
        self.owner_count.insert(who.clone(), c + 1);
    }

    fn dec_owner(&mut self, who: &AccountId) {
        let c = self.owner_count.get(who).copied().unwrap_or(0);
        if c <= 1 {
            self.owner_count.remove(who);
        } else {
            self.owner_count.insert(who.clone(), c - 1);
        }
    }

    /// Apply `(owner, seq)` from the piece if newer; emits NEP-171 `nft_transfer` (N19).
    fn apply_owner(&mut self, token_id: &str, owner: AccountId, seq: u64) -> bool {
        let Some(e) = self.tokens.get(token_id).cloned() else { return false };
        if seq <= e.seq {
            return false;
        }
        let old = e.owner.clone();
        if old != owner {
            self.dec_owner(&old);
            self.inc_owner(&owner);
            nep171("nft_transfer", json!({ "old_owner_id": old, "new_owner_id": owner, "token_ids": [token_id] }));
        }
        self.tokens.insert(token_id.to_string(), TokenEntry { owner, seq, ..e });
        true
    }

    /// Parse the piece's `OwnerView` result from promise 0; `None` if the call failed.
    fn read_owner_view() -> Option<OwnerView> {
        let bytes = env::promise_result_checked(0, 4096).ok()?;
        serde_json::from_slice::<OwnerView>(&bytes).ok()
    }
}

#[cfg(test)]
mod tests;
