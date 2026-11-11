//! near-sdk wrapper: env → `Ctx`, `Effects` → promises and logs, plus the live storage check
//! (A17) and the excess-deposit refund (A13). No upgrade path, no key management (A8).
use crate::core::{Ctx, Effect, Effects, Error, PieceCore, SlotId, Verifier};
use crate::views::*;
use common::*;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::Deserialize;
use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId, NearToken, PanicOnDefault, PublicKey};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Piece {
    core: PieceCore,
}

struct EnvVerifier;
impl Verifier for EnvVerifier {
    fn ed25519(&self, sig: &Bytes64, msg: &[u8], pk: &Bytes32) -> bool {
        env::ed25519_verify(&sig.0, msg, &pk.0)
    }
}

/// `ft_on_transfer` message (A14).
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", tag = "action", rename_all = "snake_case")]
enum FtAction {
    Fund { expected_terms_hash: Bytes32, beneficiary: Option<AccountId> },
    Buy { nonce: U64, max_price: U128, expected_pool_min: U128 },
    PayIncome,
    Reject,
}

/// Worst-case state growth of a `buy`: a new credit entry (≤ 64-byte account + slot + framing)
/// plus an owner id up to 62 bytes longer than the seller's, less nothing (listing removal is
/// not counted).
pub const BUY_RESERVE_BYTES: u128 = 200;

fn fail(e: Error) -> ! {
    env::panic_str(e.as_str())
}

fn raw_key(pk: &PublicKey) -> Bytes32 {
    ed25519_raw(pk).unwrap_or_else(|| env::panic_str("ERR_KEY_NOT_ED25519"))
}

fn near_ctx() -> Ctx {
    let p = env::predecessor_account_id();
    Ctx {
        payer: p.clone(),
        predecessor: p,
        token: None,
        attached: env::attached_deposit().as_yoctonear(),
        now: env::block_timestamp(),
        prepaid_gas: env::prepaid_gas().as_gas(),
    }
}

impl Piece {
    fn is_near_piece(&self) -> bool {
        self.core.cur.currency == Currency::Near
    }

    /// NEAR the piece owes (A43). FT pieces owe tokens, not NEAR.
    fn near_liabilities(&self) -> u128 {
        if self.is_near_piece() { self.core.liabilities() } else { 0 }
    }

    /// Flush, then require `storage_usage × byte_cost ≤ near_balance − near_liabilities` (A17).
    /// Returns the headroom above the requirement.
    fn check_storage(&self) -> u128 {
        env::state_write(self);
        let need = env::storage_byte_cost().as_yoctonear() * env::storage_usage() as u128 + self.near_liabilities();
        let have = env::account_balance().as_yoctonear();
        if have < need {
            env::panic_str("ERR_STORAGE");
        }
        have - need
    }

    /// Run effects with low-level promise calls only (no `near_sdk::Promise`, whose builder links
    /// deploy/key host functions; A8). Nothing waits on these promises; callbacks still run.
    fn apply(&self, fx: Effects) {
        let me = env::current_account_id();
        let zero = NearToken::from_yoctonear(0);
        for e in fx {
            match e {
                Effect::Event(ev) => ev.emit(),
                Effect::TransferNear { to, amount, slot } => {
                    let p = env::promise_batch_create(&to);
                    env::promise_batch_action_transfer(p, NearToken::from_yoctonear(amount));
                    let args = json!({ "slot": slot, "amount": U128(amount) }).to_string();
                    env::promise_then(p, me.clone(), "on_transfer_result", args, zero, gas::NEAR_TRANSFER_CALLBACK);
                }
                Effect::TransferFt { token, to, amount, slot } => {
                    let args = json!({ "receiver_id": to, "amount": U128(amount), "memo": "soulprint claim" }).to_string();
                    let p = env::promise_create(token, "ft_transfer", args, NearToken::from_yoctonear(1), gas::FT_TRANSFER);
                    let args = json!({ "slot": slot, "amount": U128(amount) }).to_string();
                    env::promise_then(p, me.clone(), "on_transfer_result", args, zero, gas::FT_TRANSFER_CALLBACK);
                }
                Effect::NotifyCollection { seq, owner } => {
                    let args = json!({ "token_id": token_id_of(&self.core.piece_id), "owner": owner, "seq": U64(seq) }).to_string();
                    env::promise_create(self.core.collection.clone(), "on_rotated", args, zero, gas::NOTIFY_COLLECTION);
                }
            }
        }
    }

    fn send_near(to: &AccountId, amount: u128) {
        let p = env::promise_batch_create(to);
        env::promise_batch_action_transfer(p, NearToken::from_yoctonear(amount));
    }

    /// Mutating entry with a NEAR context. `value_call` = the attached deposit is the payment itself.
    fn run(&mut self, value_call: bool, f: impl FnOnce(&mut PieceCore, &Ctx) -> Result<Effects, Error>) {
        self.run_keeping(value_call, 0, f)
    }

    /// As `run`, but the piece must keep `keep` yoctoNEAR of headroom after the call (paid from
    /// the attached deposit if needed). Every dispatched `ft_transfer` also takes 1 yocto from
    /// the piece's balance (NEP-141), so that is kept too.
    fn run_keeping(&mut self, value_call: bool, keep: u128, f: impl FnOnce(&mut PieceCore, &Ctx) -> Result<Effects, Error>) {
        let ctx = near_ctx();
        let fx = f(&mut self.core, &ctx).unwrap_or_else(|e| fail(e));
        let ft_outflow = fx.iter().filter(|e| matches!(e, Effect::TransferFt { .. })).count() as u128;
        let spare = self.check_storage().checked_sub(keep + ft_outflow).unwrap_or_else(|| env::panic_str("ERR_STORAGE"));
        // A13: anything above 1 yocto not needed for storage is refunded.
        if !value_call && ctx.attached > 1 {
            let refund = (ctx.attached - 1).min(spare);
            if refund > 0 {
                Self::send_near(&ctx.predecessor, refund);
            }
        }
        self.apply(fx);
    }
}

#[near]
impl Piece {
    /// Called once, by the collection, in the creation batch.
    #[init]
    pub fn init(kind: PieceKind, artist: AccountId, capture_pubkey: PublicKey, time: TimeConfig, currency: CurrencyConfig) -> Self {
        let me = env::current_account_id();
        let parent = env::predecessor_account_id();
        if !me.as_str().ends_with(&format!(".{parent}")) {
            env::panic_str("ERR_NOT_PARENT");
        }
        let core = PieceCore::new(me, parent, artist, kind, raw_key(&capture_pubkey), time, currency, env::block_timestamp())
            .unwrap_or_else(|e| fail(e));
        Self { core }
    }

    // ---------- payments in ----------

    #[payable]
    pub fn fund(&mut self, expected_terms_hash: Bytes32, beneficiary: Option<AccountId>) {
        self.run(true, |c, ctx| c.fund(ctx, expected_terms_hash, beneficiary));
    }

    #[payable]
    pub fn buy(&mut self, nonce: U64, max_price: U128, expected_pool_min: U128) {
        self.run(true, |c, ctx| c.buy(ctx, nonce.0, max_price.0, expected_pool_min.0));
    }

    #[payable]
    pub fn pay_income(&mut self) {
        self.run(true, |c, ctx| c.pay_income(ctx));
    }

    #[payable]
    pub fn reject(&mut self) {
        self.run(true, |c, ctx| c.reject(ctx));
    }

    /// NEP-141 receiver. First check: the predecessor is this piece's currency (T14); anything
    /// else, or any rejected action, returns the full amount (A14: no partial acceptance).
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        let token = env::predecessor_account_id();
        if self.core.cur.currency != Currency::Ft(token.clone()) {
            env::log_str("ERR_WRONG_CURRENCY");
            return amount;
        }
        let Ok(action) = near_sdk::serde_json::from_str::<FtAction>(&msg) else {
            env::log_str("ERR_BAD_MSG");
            return amount;
        };
        let ctx = Ctx {
            predecessor: sender_id.clone(),
            payer: sender_id,
            token: Some(token),
            attached: amount.0,
            now: env::block_timestamp(),
            prepaid_gas: env::prepaid_gas().as_gas(),
        };
        let r = match action {
            FtAction::Fund { expected_terms_hash, beneficiary } => self.core.fund(&ctx, expected_terms_hash, beneficiary),
            FtAction::Buy { nonce, max_price, expected_pool_min } => {
                self.core.buy(&ctx, nonce.0, max_price.0, expected_pool_min.0)
            }
            FtAction::PayIncome => self.core.pay_income(&ctx),
            FtAction::Reject => self.core.reject(&ctx),
        };
        match r {
            Ok(fx) => {
                self.check_storage();
                self.apply(fx);
                U128(0)
            }
            Err(e) => {
                env::log_str(e.as_str());
                amount
            }
        }
    }

    // ---------- commission ----------

    #[payable]
    pub fn deliver(&mut self, final_file_hash: Bytes32, report_hash: Bytes32) {
        self.run(false, |c, ctx| c.deliver(ctx, final_file_hash, report_hash));
    }
    #[payable]
    pub fn request_changes(&mut self) {
        self.run(false, |c, ctx| c.request_changes(ctx));
    }
    #[payable]
    pub fn release_milestone(&mut self, index: u8) {
        self.run(false, |c, ctx| c.release_milestone(ctx, index));
    }
    #[payable]
    pub fn accept(&mut self) {
        self.run(false, |c, ctx| c.accept(ctx));
    }
    pub fn settle(&mut self) {
        self.run(false, |c, ctx| c.settle(ctx));
    }
    #[payable]
    pub fn claim_refund(&mut self) {
        self.run(false, |c, ctx| c.claim_refund(ctx));
    }
    #[payable]
    pub fn cancel(&mut self) {
        self.run(false, |c, ctx| c.cancel(ctx));
    }
    #[payable]
    pub fn consent_mutual_cancel(&mut self) {
        self.run(false, |c, ctx| c.consent_mutual_cancel(ctx));
    }
    #[payable]
    pub fn consent_extend(&mut self, new_deadline: U64) {
        self.run(false, |c, ctx| c.consent_extend(ctx, new_deadline.0));
    }
    #[payable]
    pub fn settle_standalone(&mut self, final_file_hash: Bytes32, report_hash: Bytes32) {
        self.run(false, |c, ctx| c.settle_standalone(ctx, final_file_hash, report_hash));
    }
    #[payable]
    pub fn reopen_as_standalone(&mut self) {
        self.run(false, |c, ctx| c.reopen_as_standalone(ctx));
    }

    // ---------- dispute ----------

    #[payable]
    pub fn propose_split(&mut self, artist_bps: u16) {
        self.run(false, |c, ctx| c.propose_split(ctx, artist_bps));
    }
    #[payable]
    pub fn accept_split(&mut self, expected_artist_bps: u16, proposal_nonce: u32) {
        self.run(false, |c, ctx| c.accept_split(ctx, expected_artist_bps, proposal_nonce));
    }
    #[payable]
    pub fn resolve(&mut self, artist_bps: u16) {
        self.run(false, |c, ctx| c.resolve(ctx, artist_bps));
    }
    pub fn timeout_resolve(&mut self) {
        self.run(false, |c, ctx| c.timeout_resolve(ctx));
    }

    // ---------- money out ----------

    pub fn claim(&mut self) {
        self.run(false, |c, ctx| c.claim(ctx));
    }
    #[payable]
    pub fn claim_to(&mut self, recipient: AccountId) {
        self.run(false, |c, ctx| c.claim_to(ctx, recipient));
    }
    #[payable]
    pub fn withdraw(&mut self) {
        self.run(false, |c, ctx| c.withdraw(ctx));
    }

    /// Callback for a dispatched transfer (A16): no balance checks, no storage growth, no panics.
    #[private]
    pub fn on_transfer_result(&mut self, slot: SlotId, amount: U128) {
        let ok = env::promise_result_checked(0, 64).is_ok();
        let fx = self.core.on_transfer_result(slot, amount.0, ok);
        for e in fx {
            if let Effect::Event(ev) = e {
                ev.emit();
            }
        }
    }

    // ---------- resale ----------

    #[payable]
    pub fn list(&mut self, price: U128, reserved_for: Option<AccountId>) {
        // A buy (NEAR or FT) carries no storage deposit but may grow state: the seller's new
        // credit entry and a longer owner id. The lister pays for those bytes up front.
        let keep = env::storage_byte_cost().as_yoctonear() * BUY_RESERVE_BYTES;
        self.run_keeping(false, keep, |c, ctx| c.list(ctx, price.0, reserved_for));
    }
    #[payable]
    pub fn delist(&mut self) {
        self.run(false, |c, ctx| c.delist(ctx));
    }

    // ---------- proof ----------

    pub fn anchor(&mut self, key: PublicKey, head: Bytes32, count: u32, sig: Bytes64) {
        let k = raw_key(&key);
        self.run(false, |c, ctx| c.anchor(ctx, &EnvVerifier, k, head, count, sig));
    }
    #[payable]
    pub fn add_capture_key(&mut self, key: PublicKey) {
        let k = raw_key(&key);
        self.run(false, |c, ctx| c.add_capture_key(ctx, k));
    }
    #[payable]
    pub fn invite_challenger(&mut self, account: AccountId) {
        self.run(false, |c, ctx| c.invite_challenger(ctx, account));
    }
    #[payable]
    pub fn issue_challenge(&mut self, nonce_hash: Bytes32) {
        self.run(false, |c, ctx| c.issue_challenge(ctx, nonce_hash));
    }
    pub fn ack_challenge(&mut self, challenge_id: u32, sig: Bytes64) {
        self.run(false, |c, ctx| c.ack_challenge(ctx, &EnvVerifier, challenge_id, sig));
    }
    pub fn record_attestation(&mut self, msg: ReportMessage, key_id: u16) {
        self.run(false, |c, ctx| c.record_attestation(ctx, msg, key_id));
    }
    #[payable]
    pub fn propose_addendum(&mut self, grant: Grant, text_hash: Bytes32) {
        self.run(false, |c, ctx| c.propose_addendum(ctx, grant, text_hash));
    }
    #[payable]
    pub fn accept_addendum(&mut self, expected_hash: Bytes32) {
        self.run(false, |c, ctx| c.accept_addendum(ctx, expected_hash));
    }

    // ---------- ownership (collection) ----------

    /// Returns the piece's view of ownership after the change; the collection indexes it.
    pub fn rotate_owner(&mut self, sender: AccountId, receiver: AccountId, call: bool) -> OwnerView {
        self.run(false, |c, ctx| c.rotate_owner(ctx, sender, receiver, call));
        self.core.owner_view(env::block_timestamp())
    }
    pub fn resolve_transfer(&mut self, revert: bool) -> OwnerView {
        self.run(false, |c, ctx| c.resolve_transfer(ctx, revert));
        self.core.owner_view(env::block_timestamp())
    }
    pub fn expire_pending(&mut self) {
        self.run(false, |c, ctx| c.expire_pending(ctx));
    }

    // ---------- views ----------

    pub fn piece_info(&self) -> PieceInfo {
        self.core.info(env::block_timestamp())
    }
    pub fn terms(&self) -> Option<Terms> {
        self.core.terms.clone()
    }
    pub fn accounting(&self) -> AccountingView {
        self.core.accounting_view(env::account_balance().as_yoctonear(), env::storage_usage())
    }
    pub fn proof_page(&self, from: u32, limit: u32) -> ProofView {
        self.core.proof_view(from, limit)
    }
    pub fn listing(&self) -> Option<ListingView> {
        self.core.listing_view()
    }
    pub fn owner_info(&self) -> OwnerView {
        self.core.owner_view(env::block_timestamp())
    }
    pub fn time_config(&self) -> TimeConfig {
        self.core.time
    }
    /// Sharded-item draft fields.
    pub fn nft_item_info(&self) -> ItemInfo {
        ItemInfo {
            token_id: token_id_of(&self.core.piece_id),
            collection: self.core.collection.clone(),
            owner: self.core.owner.clone(),
            creator: self.core.artist.clone(),
            status: self.core.view_status(env::block_timestamp()),
            royalty_bps: self.core.royalty_bps,
        }
    }
}
