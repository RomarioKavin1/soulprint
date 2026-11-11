use crate::{Bytes32, TimeConfig};
use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

pub const BPS_DENOM: u16 = 10_000;
pub const MAX_MILESTONES: usize = 5;
pub const MAX_ROYALTY_BPS: u16 = 1_500;
pub const MAX_REJECT_BOND_BPS: u16 = 1_000;
pub const MAX_REVISION_ROUNDS: u8 = 10;
pub const DEFAULT_ROYALTY_BPS: u16 = 500;
pub const DEFAULT_REJECT_BOND_BPS: u16 = 500;
/// A22, confirmed by Romario 2026-11-11.
pub const DEFAULT_TIMEOUT_ARTIST_BPS: u16 = 7_500;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Currency {
    Near,
    Ft(AccountId),
}

/// Per-currency config fixed at collection genesis (A46). Amounts in the currency's smallest unit.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CurrencyConfig {
    pub currency: Currency,
    pub decimals: u8,
    pub min_price: U128,
    pub min_list: U128,
    pub min_income: U128,
    /// Minimum price for the "Commissioned and accepted" badge (A29).
    pub badge_min: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Milestone {
    pub bps: u16,
}

/// Ordered by width: a wider grant compares greater.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum GrantType {
    Personal,
    CommercialNonExclusive,
    CommercialExclusive,
    FullAssignment,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Grant {
    pub kind: GrantType,
    pub attribution: bool,
    pub transferable: bool,
}

impl Grant {
    /// `other` is at least as wide as `self` in every dimension and wider in one.
    /// Attribution required → not required is a widening; transferable false → true is a widening.
    pub fn is_widened_by(&self, other: &Grant) -> bool {
        let ge = other.kind >= self.kind
            && (!other.attribution || self.attribution)
            && (other.transferable || !self.transferable);
        ge && other != self
    }
}

/// Commission terms; hashed and pinned at `fund(expected_terms_hash)` (T7).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Terms {
    pub price: U128,
    pub currency: Currency,
    pub milestones: Vec<Milestone>,
    pub deadline_ns: U64,
    pub grace_ns: U64,
    pub review_window_ns: U64,
    pub revision_period_ns: U64,
    pub revision_rounds: u8,
    pub arbitrator: AccountId,
    pub fallback_arbitrator: AccountId,
    pub timeout_artist_bps: u16,
    pub reject_bond_bps: u16,
    pub royalty_bps: u16,
    pub grant: Grant,
    pub licence_text_hash: Bytes32,
    pub client: Option<AccountId>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StandaloneTerms {
    pub currency: Currency,
    pub royalty_bps: u16,
    pub grant: Grant,
    pub licence_text_hash: Bytes32,
}

/// The one creation shape (A50).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PieceKind {
    Commission(Terms),
    Standalone(StandaloneTerms),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TermsError {
    MilestoneCount,
    MilestoneZero,
    MilestoneSum,
    Royalty,
    Bond,
    TimeoutBps,
    Grace,
    ReviewWindow,
    RevisionPeriod,
    RevisionRounds,
    Deadline,
    Price,
    Currency,
    Arbitrator,
    Client,
}

impl core::fmt::Display for TermsError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "terms: {self:?}")
    }
}

impl Terms {
    pub fn validate(
        &self,
        artist: &AccountId,
        now: u64,
        time: &TimeConfig,
        cur: &CurrencyConfig,
    ) -> Result<(), TermsError> {
        use TermsError::*;
        if self.milestones.is_empty() || self.milestones.len() > MAX_MILESTONES {
            return Err(MilestoneCount);
        }
        if self.milestones.iter().any(|m| m.bps == 0) {
            return Err(MilestoneZero);
        }
        if self.milestones.iter().map(|m| m.bps as u32).sum::<u32>() != BPS_DENOM as u32 {
            return Err(MilestoneSum);
        }
        if self.royalty_bps > MAX_ROYALTY_BPS {
            return Err(Royalty);
        }
        if self.reject_bond_bps > MAX_REJECT_BOND_BPS {
            return Err(Bond);
        }
        if self.timeout_artist_bps > BPS_DENOM {
            return Err(TimeoutBps);
        }
        if self.grace_ns.0 > time.grace_max {
            return Err(Grace);
        }
        if self.review_window_ns.0 < time.review_min {
            return Err(ReviewWindow);
        }
        if self.revision_period_ns.0 < time.revision_period_min {
            return Err(RevisionPeriod);
        }
        if self.revision_rounds > MAX_REVISION_ROUNDS {
            return Err(RevisionRounds);
        }
        let d = self.deadline_ns.0;
        if d <= now.saturating_add(time.deadline_min_lead) || d > now.saturating_add(time.deadline_max) {
            return Err(Deadline);
        }
        if self.currency != cur.currency {
            return Err(Currency);
        }
        if self.price.0 < cur.min_price.0 {
            return Err(Price);
        }
        let client = self.client.as_ref();
        for a in [&self.arbitrator, &self.fallback_arbitrator] {
            if a == artist || Some(a) == client {
                return Err(Arbitrator);
            }
        }
        if self.arbitrator == self.fallback_arbitrator {
            return Err(Arbitrator);
        }
        if client == Some(artist) {
            return Err(Client);
        }
        Ok(())
    }

    pub fn hash(&self) -> Bytes32 {
        crate::sha256(&near_sdk::borsh::to_vec(self).expect("borsh"))
    }
}

impl StandaloneTerms {
    pub fn validate(&self, cur: &CurrencyConfig) -> Result<(), TermsError> {
        if self.royalty_bps > MAX_ROYALTY_BPS {
            return Err(TermsError::Royalty);
        }
        if self.currency != cur.currency {
            return Err(TermsError::Currency);
        }
        Ok(())
    }
}
