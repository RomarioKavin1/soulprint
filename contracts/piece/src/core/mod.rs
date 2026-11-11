//! Pure piece logic. No host calls: every method takes a `Ctx` and returns `Effects`.
//! The near-sdk wrapper (`contract.rs`) turns effects into promises and logs. A method that
//! returns `Err` must leave `self` untouched; the wrapper panics, which reverts the receipt (A42).

use common::*;
use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};
use std::collections::BTreeMap;

pub mod accounting;
pub mod commission;
pub mod dispute;
pub mod ownership;
pub mod proof;
pub mod resale;
pub mod status;

pub use status::DisputeStage;

pub const MAX_CAPTURE_KEYS: usize = 4;
pub const MAX_ANCHORS: u16 = 512;
pub const MAX_CHALLENGES: usize = 32;
pub const MAX_CHALLENGES_PER_ISSUER: usize = 8;
pub const MAX_INVITES: usize = 16;
pub const MAX_ADDENDA: usize = 8;

/// Call context, built by the wrapper from `env` (or by tests / the fuzzer).
#[derive(Clone, Debug)]
pub struct Ctx {
    /// Caller. For FT actions this is `sender_id` of `ft_on_transfer` (A14).
    pub predecessor: AccountId,
    pub payer: AccountId,
    /// `Some(token)` for FT actions (the token contract, already checked by the wrapper).
    pub token: Option<AccountId>,
    /// Attached NEAR (yocto) for NEAR calls, or the FT amount for FT actions.
    pub attached: u128,
    pub now: u64,
    pub prepaid_gas: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum SlotId {
    Credit(AccountId),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Effect {
    TransferNear { to: AccountId, amount: u128, slot: SlotId },
    TransferFt { token: AccountId, to: AccountId, amount: u128, slot: SlotId },
    Event(SoulprintEvent),
    /// Tell the collection the owner changed (piece → `collection.on_rotated`).
    NotifyCollection { seq: u64, owner: AccountId },
}

pub type Effects = Vec<Effect>;

pub trait Verifier {
    fn ed25519(&self, sig: &Bytes64, msg: &[u8], pk: &Bytes32) -> bool;
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Commission,
    Standalone,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Offered,
    InProgress,
    Delivered,
    Disputed,
    Settled,
    Refunded,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Slot {
    pub available: u128,
    pub in_flight: u128,
    pub prefunded: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pending {
    pub from: AccountId,
    pub to: AccountId,
    pub seq: u64,
    pub expires_at: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Listing {
    pub seller: AccountId,
    pub price: u128,
    pub nonce: u64,
    pub reserved_for: Option<AccountId>,
}

/// Consents are only valid for the `rotation_seq` they were given at (M4).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Consents {
    pub cancel_artist: Option<u64>,
    pub cancel_owner: Option<u64>,
    /// (new_deadline, seq) per party.
    pub extend_artist: Option<(u64, u64)>,
    pub extend_owner: Option<(u64, u64)>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SplitProposal {
    pub by: AccountId,
    pub artist_bps: u16,
    pub nonce: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Segment {
    pub key: Bytes32,
    pub head: Bytes32,
    pub count: u32,
    pub last_anchor_at: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Challenge {
    pub issuer: AccountId,
    pub issuer_class: IssuerClass,
    pub nonce_hash: Bytes32,
    pub issued_at: u64,
    pub acked_at: Option<u64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Attestation {
    pub evidence_level: u8,
    pub key_id: u16,
    pub issued_at: u64,
    pub attested_at: u64,
    pub report_hash: Bytes32,
}


#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Addendum {
    pub grant: Grant,
    pub text_hash: Bytes32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    Terms(TermsError),
    RequiresDeposit,
    NotArtist,
    NotOwner,
    NotCollection,
    NotParty,
    NotArbitrator,
    TransferPending,
    NoTransferPending,
    WrongStatus,
    WrongCurrency,
    WrongAmount,
    TermsChanged,
    NotNamedClient,
    FunderNotAllowed,
    FundCutoff,
    DeadlinePassed,
    RefundNotYet,
    ReviewClosed,
    ReviewOpen,
    NoRevisionsLeft,
    MilestoneOrder,
    NoMilestonesLeft,
    WrongStage,
    NoProposal,
    ProposalChanged,
    OwnProposal,
    InvalidBps,
    NothingToClaim,
    ClaimInFlight,
    InvalidRecipient,
    PoolEmpty,
    Listed,
    NotListed,
    ListingChanged,
    PriceTooHigh,
    PriceTooLow,
    PoolBelowExpected,
    BuyerIsSeller,
    Reserved,
    IncomeTooSmall,
    IncomeNotLicensed,
    InvalidReceiver,
    PendingNotExpired,
    UnknownKey,
    TooManyKeys,
    BadSignature,
    AnchorNotMonotonic,
    TooManyAnchors,
    NotChallenger,
    ChallengeOpen,
    ChallengeTooSoon,
    TooManyChallenges,
    NoSuchChallenge,
    ChallengeClosed,
    TooManyInvites,
    AlreadyInvited,
    WrongPiece,
    ReportMismatch,
    StaleReport,
    AddendumNotWider,
    NoAddendum,
    AddendumChanged,
    TooManyAddenda,
    AlreadyConsented,
    InvalidDeadline,
    NotStandaloneEligible,
    NotEnoughGas,
    DuplicateKey,
}

impl core::fmt::Display for Error {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        if let Error::Terms(t) = self {
            return write!(f, "ERR_TERMS_{t:?}");
        }
        let name = format!("{self:?}");
        let mut out = String::from("ERR");
        for (i, ch) in name.chars().enumerate() {
            if ch.is_uppercase() || i == 0 {
                out.push('_');
            }
            out.push(ch.to_ascii_uppercase());
        }
        f.write_str(&out)
    }
}

impl From<TermsError> for Error {
    fn from(e: TermsError) -> Self {
        Error::Terms(e)
    }
}

pub type Res<T = Effects> = Result<T, Error>;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PieceCore {
    pub piece_id: AccountId,
    pub collection: AccountId,
    pub mode: Mode,
    pub artist: AccountId,
    pub owner: AccountId,
    pub rotation_seq: u64,
    pub status: Status,
    pub transfer_pending: Option<Pending>,
    pub time: TimeConfig,
    pub cur: CurrencyConfig,
    pub royalty_bps: u16,
    /// Current grant: terms grant widened by accepted addenda.
    pub grant: Grant,
    pub licence_text_hash: Bytes32,
    pub terms: Option<Terms>,
    pub terms_hash: Option<Bytes32>,
    /// Current deadline (starts at terms.deadline_ns; extended by consent or revisions, A11).
    pub deadline: u64,
    pub funder: Option<AccountId>,
    pub funded: u128,
    pub escrow: u128,
    pub released: u128,
    pub refunded: u128,
    pub holder_pool: u128,
    pub bond: u128,
    pub bond_payer: Option<AccountId>,
    pub credits: BTreeMap<AccountId, Slot>,
    pub listing: Option<Listing>,
    pub listing_nonce: u64,
    pub consents: Consents,
    pub split: Option<SplitProposal>,
    pub split_nonce: u32,
    pub revisions_used: u8,
    pub released_milestones: u8,
    pub delivered_at: Option<u64>,
    pub disputed_at: Option<u64>,
    pub final_file_hash: Option<Bytes32>,
    pub report_hash: Option<Bytes32>,
    pub capture_keys: Vec<Bytes32>,
    pub segments: Vec<Segment>,
    pub anchors_total: u16,
    pub invites: Vec<AccountId>,
    pub challenges: Vec<Challenge>,
    pub attestation: Attestation,
    pub addenda: Vec<Addendum>,
    pub pending_addendum: Option<Addendum>,
    /// Settled through escrow and accepted (or review lapse / ≥50% split). Basis of the badge (A29).
    pub commissioned: bool,
    pub created_at: u64,
}

impl PieceCore {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        piece_id: AccountId,
        collection: AccountId,
        artist: AccountId,
        kind: PieceKind,
        capture_key: Bytes32,
        time: TimeConfig,
        cur: CurrencyConfig,
        now: u64,
    ) -> Res<Self> {
        let mut credits = BTreeMap::new();
        let prefunded = Slot { prefunded: true, ..Default::default() };
        credits.insert(artist.clone(), prefunded.clone());
        let (mode, royalty_bps, grant, licence_text_hash, terms, terms_hash, deadline) = match kind {
            PieceKind::Commission(t) => {
                t.validate(&artist, now, &time, &cur)?;
                for a in [Some(&t.arbitrator), Some(&t.fallback_arbitrator), t.client.as_ref()].into_iter().flatten() {
                    credits.insert(a.clone(), prefunded.clone());
                }
                let h = t.hash();
                (Mode::Commission, t.royalty_bps, t.grant, t.licence_text_hash, Some(t.clone()), Some(h), t.deadline_ns.0)
            }
            PieceKind::Standalone(s) => {
                s.validate(&cur)?;
                (Mode::Standalone, s.royalty_bps, s.grant, s.licence_text_hash, None, None, 0)
            }
        };
        Ok(Self {
            segments: vec![Segment { key: capture_key, head: genesis(&piece_id, &capture_key), count: 0, last_anchor_at: 0 }],
            piece_id,
            collection,
            mode,
            owner: artist.clone(),
            artist,
            rotation_seq: 0,
            status: Status::Offered,
            transfer_pending: None,
            time,
            cur,
            royalty_bps,
            grant,
            licence_text_hash,
            terms,
            terms_hash,
            deadline,
            funder: None,
            funded: 0,
            escrow: 0,
            released: 0,
            refunded: 0,
            holder_pool: 0,
            bond: 0,
            bond_payer: None,
            credits,
            listing: None,
            listing_nonce: 0,
            consents: Consents::default(),
            split: None,
            split_nonce: 0,
            revisions_used: 0,
            released_milestones: 0,
            delivered_at: None,
            disputed_at: None,
            final_file_hash: None,
            report_hash: None,
            capture_keys: vec![capture_key],
            anchors_total: 0,
            invites: vec![],
            challenges: vec![],
            attestation: Attestation::default(),
            addenda: vec![],
            pending_addendum: None,
            commissioned: false,
            created_at: now,
        })
    }

    // ---------- auth helpers ----------

    /// A13: gated methods need ≥ 1 yocto of NEAR (function-call access keys cannot attach deposits).
    pub fn require_yocto(&self, ctx: &Ctx) -> Res<()> {
        if ctx.token.is_some() || ctx.attached < 1 {
            return Err(Error::RequiresDeposit);
        }
        Ok(())
    }
    pub fn require_artist(&self, ctx: &Ctx) -> Res<()> {
        if ctx.predecessor != self.artist {
            return Err(Error::NotArtist);
        }
        Ok(())
    }
    pub fn require_owner(&self, ctx: &Ctx) -> Res<()> {
        if ctx.predecessor != self.owner {
            return Err(Error::NotOwner);
        }
        Ok(())
    }
    pub fn require_collection(&self, ctx: &Ctx) -> Res<()> {
        if ctx.predecessor != self.collection {
            return Err(Error::NotCollection);
        }
        Ok(())
    }
    pub fn require_not_pending(&self) -> Res<()> {
        if self.transfer_pending.is_some() {
            return Err(Error::TransferPending);
        }
        Ok(())
    }
    /// Owner action: yocto + owner + not pending (I6).
    pub fn require_owner_action(&self, ctx: &Ctx) -> Res<()> {
        self.require_yocto(ctx)?;
        self.require_owner(ctx)?;
        self.require_not_pending()
    }
    pub fn require_artist_action(&self, ctx: &Ctx) -> Res<()> {
        self.require_yocto(ctx)?;
        self.require_artist(ctx)
    }

    /// Value carried by a value action (fund / buy / pay_income / reject bond), in the piece's currency.
    pub fn value(&self, ctx: &Ctx) -> Res<u128> {
        match (&self.cur.currency, &ctx.token) {
            (Currency::Near, None) => Ok(ctx.attached),
            (Currency::Ft(t), Some(got)) if t == got => Ok(ctx.attached),
            _ => Err(Error::WrongCurrency),
        }
    }

    // ---------- shared mutations ----------

    pub(crate) fn ev(&self, fx: &mut Effects, e: SoulprintEvent) {
        fx.push(Effect::Event(e));
    }

    /// Credit `amount` to `who` (creates a non-prefunded slot if needed; storage is checked by the wrapper).
    pub(crate) fn credit(&mut self, who: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        let s = self.credits.entry(who.clone()).or_default();
        s.available = s.available.checked_add(amount).expect("overflow");
    }

    /// Ownership change. Bumps seq, clears consents/listing/split, emits `owner_changed`;
    /// `notify` adds a NotifyCollection effect (piece-initiated changes; collection-initiated ones
    /// are recorded by the collection's own callback).
    pub(crate) fn set_owner(&mut self, fx: &mut Effects, new_owner: AccountId, cause: OwnerChangeCause, notify: bool) {
        let old = core::mem::replace(&mut self.owner, new_owner.clone());
        self.rotation_seq += 1;
        self.consents = Consents::default();
        self.listing = None;
        self.ev(
            fx,
            SoulprintEvent::OwnerChanged {
                piece_id: self.piece_id.clone(),
                old_owner: old,
                new_owner: new_owner.clone(),
                seq: U64(self.rotation_seq),
                cause,
            },
        );
        if notify {
            fx.push(Effect::NotifyCollection { seq: self.rotation_seq, owner: new_owner });
        }
    }

    pub(crate) fn price(&self) -> u128 {
        self.terms.as_ref().map(|t| t.price.0).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests;

impl PieceCore {
    /// Run `f` on a copy and commit only on success: a rejected call changes nothing,
    /// including any transition `materialise` would have made (A42).
    pub(crate) fn tx(&mut self, now: u64, f: impl FnOnce(&mut Self, &mut Effects) -> Res<()>) -> Res {
        let mut next = self.clone();
        let mut fx = next.materialise(now);
        f(&mut next, &mut fx)?;
        *self = next;
        Ok(fx)
    }

    /// Grant is active only once Settled (refunds void it; A21 splits < 50% end Refunded).
    pub fn grant_active(&self) -> bool {
        self.status == Status::Settled
    }

    pub(crate) fn is_party(&self, who: &AccountId) -> bool {
        who == &self.artist || who == &self.owner
    }
}
