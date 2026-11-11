//! Types shared by the piece and collection contracts and by off-chain code
//! (evidence service test vectors, sandbox tooling). Pure: no host calls.

mod bytes;
mod events;
pub mod gas;
mod messages;
mod terms;
mod time;

pub use bytes::{ed25519_pk, ed25519_raw, Bytes32, Bytes64};
pub use events::{IssuerClass, OwnerChangeCause, ResolveOutcome, SoulprintEvent, EVENT_STANDARD, EVENT_VERSION};
pub use messages::{
    chain_link, genesis, segments_digest, sha256, AnchorMessage, BatchMessage, ChallengeAckMessage, ReportMessage,
    ANCHOR_DOMAIN, BATCH_DOMAIN, CHALLENGE_ACK_DOMAIN, REPORT_DOMAIN,
};
pub use terms::{
    Currency, CurrencyConfig, Grant, GrantType, Milestone, PieceKind, StandaloneTerms, Terms, TermsError,
    BPS_DENOM, DEFAULT_REJECT_BOND_BPS, DEFAULT_ROYALTY_BPS, DEFAULT_TIMEOUT_ARTIST_BPS, MAX_MILESTONES,
    MAX_REJECT_BOND_BPS, MAX_REVISION_ROUNDS, MAX_ROYALTY_BPS,
};
pub use time::TimeConfig;

/// Evidence levels (A32: E1 removed).
pub const LEVEL_E0: u8 = 0;
pub const LEVEL_E2: u8 = 2;
pub const LEVEL_E3: u8 = 3;

#[cfg(test)]
mod tests;
