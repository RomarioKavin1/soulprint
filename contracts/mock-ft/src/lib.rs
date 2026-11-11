//! Test-only NEP-141 "test USDC": storage registration, blacklist, pause, faucet (A52).
use near_contract_standards::fungible_token::metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC};
use near_contract_standards::fungible_token::{FungibleToken, FungibleTokenCore, FungibleTokenResolver};
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::U128;
use near_sdk::store::LookupSet;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue};

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Token,
    Blacklist,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockFt {
    owner: AccountId,
    token: FungibleToken,
    blacklist: LookupSet<AccountId>,
    paused: bool,
    decimals: u8,
    symbol: String,
}

#[near]
impl MockFt {
    #[init]
    pub fn new(owner: AccountId, decimals: u8, symbol: String) -> Self {
        Self {
            owner,
            token: FungibleToken::new(Key::Token),
            blacklist: LookupSet::new(Key::Blacklist),
            paused: false,
            decimals,
            symbol,
        }
    }

    /// Anyone gets up to 1000 whole units; the caller is registered for free (test token).
    pub fn faucet(&mut self, amount: U128) {
        let max = 1000u128 * 10u128.pow(self.decimals as u32);
        require!(amount.0 <= max, "ERR_FAUCET_LIMIT");
        let who = env::predecessor_account_id();
        if !self.token.accounts.contains_key(&who) {
            self.token.internal_register_account(&who);
        }
        self.token.internal_deposit(&who, amount.0);
    }

    pub fn set_blacklisted(&mut self, account_id: AccountId, blocked: bool) {
        require!(env::predecessor_account_id() == self.owner, "ERR_OWNER");
        if blocked {
            self.blacklist.insert(account_id);
        } else {
            self.blacklist.remove(&account_id);
        }
    }

    pub fn set_paused(&mut self, paused: bool) {
        require!(env::predecessor_account_id() == self.owner, "ERR_OWNER");
        self.paused = paused;
    }

    fn check(&self, sender: &AccountId, receiver: &AccountId) {
        require!(!self.paused, "ERR_PAUSED");
        require!(!self.blacklist.contains(sender) && !self.blacklist.contains(receiver), "ERR_BLACKLISTED");
    }
}

#[near]
impl FungibleTokenCore for MockFt {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.check(&env::predecessor_account_id(), &receiver_id);
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        self.check(&env::predecessor_account_id(), &receiver_id);
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for MockFt {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for MockFt {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        require!(!self.paused, "ERR_PAUSED");
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for MockFt {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: format!("Test {}", self.symbol),
            symbol: self.symbol.clone(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: self.decimals,
        }
    }
}
