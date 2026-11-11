//! JSON view types (A34: u64/u128 as strings, bytes base64, keys `ed25519:`).
use crate::core::*;
use common::*;
use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId, PublicKey};

#[near(serializers = [json])]
pub struct PendingView {
    pub from: AccountId,
    pub to: AccountId,
    pub seq: U64,
    pub expires_at: U64,
}

#[near(serializers = [json])]
pub struct PieceInfo {
    pub piece_id: AccountId,
    pub token_id: String,
    pub collection: AccountId,
    pub mode: Mode,
    pub artist: AccountId,
    pub owner: AccountId,
    pub rotation_seq: U64,
    pub status: Status,
    pub dispute_stage: Option<DisputeStage>,
    pub transfer_pending: Option<PendingView>,
    pub currency: Currency,
    pub price: U128,
    pub royalty_bps: u16,
    pub grant: Grant,
    pub grant_active: bool,
    pub licence_text_hash: Bytes32,
    pub terms_hash: Option<Bytes32>,
    pub deadline: U64,
    pub review_ends_at: Option<U64>,
    pub refund_eligible: bool,
    pub delivered_at: Option<U64>,
    pub disputed_at: Option<U64>,
    pub revisions_used: u8,
    pub released_milestones: u8,
    pub final_file_hash: Option<Bytes32>,
    pub report_hash: Option<Bytes32>,
    pub evidence_level: u8,
    /// "Commissioned and accepted" (A29).
    pub commissioned_badge: bool,
    pub split: Option<SplitView>,
    pub pending_addendum: Option<Addendum>,
    pub addenda: Vec<Addendum>,
    pub created_at: U64,
}

#[near(serializers = [json])]
pub struct SplitView {
    pub by: AccountId,
    pub artist_bps: u16,
    pub nonce: u32,
}

#[near(serializers = [json])]
pub struct CreditView {
    pub account: AccountId,
    pub available: U128,
    pub in_flight: U128,
}

#[near(serializers = [json])]
pub struct AccountingView {
    pub currency: Currency,
    pub funded: U128,
    pub escrow: U128,
    pub released: U128,
    pub refunded: U128,
    pub holder_pool: U128,
    pub bond: U128,
    pub liabilities: U128,
    pub credits: Vec<CreditView>,
    pub near_balance: U128,
    pub storage_usage: U64,
}

#[near(serializers = [json])]
pub struct SegmentView {
    pub key: PublicKey,
    pub genesis: Bytes32,
    pub head: Bytes32,
    pub count: u32,
    pub last_anchor_at: U64,
}

#[near(serializers = [json])]
pub struct ChallengeView {
    pub id: u32,
    pub issuer: AccountId,
    pub issuer_class: IssuerClass,
    pub nonce_hash: Bytes32,
    pub issued_at: U64,
    pub acked_at: Option<U64>,
}

#[near(serializers = [json])]
pub struct AttestationView {
    pub evidence_level: u8,
    pub key_id: u16,
    pub issued_at: U64,
    pub attested_at: U64,
    pub report_hash: Bytes32,
}

#[near(serializers = [json])]
pub struct ProofView {
    pub segments: Vec<SegmentView>,
    pub anchors_total: u16,
    pub segments_digest: Bytes32,
    pub invites: Vec<AccountId>,
    pub challenges: Vec<ChallengeView>,
    pub challenges_total: u32,
    pub attestation: AttestationView,
    pub final_file_hash: Option<Bytes32>,
    pub report_hash: Option<Bytes32>,
}

#[near(serializers = [json])]
pub struct ListingView {
    pub seller: AccountId,
    pub price: U128,
    pub nonce: U64,
    pub reserved_for: Option<AccountId>,
}

/// What the collection and the vault gate read (piece = truth, T10).
#[near(serializers = [json])]
pub struct OwnerView {
    pub token_id: String,
    pub owner: AccountId,
    pub seq: U64,
    pub status: Status,
    pub transfer_pending: bool,
}

#[near(serializers = [json])]
pub struct ItemInfo {
    pub token_id: String,
    pub collection: AccountId,
    pub owner: AccountId,
    pub creator: AccountId,
    pub status: Status,
    pub royalty_bps: u16,
}

impl PieceCore {
    pub fn badge(&self) -> bool {
        self.commissioned
            && self.status == Status::Settled
            && self.price() >= self.cur.badge_min.0
            && !self.funder.as_ref().is_some_and(|f| self.invites.contains(f))
    }

    pub fn info(&self, now: u64) -> PieceInfo {
        let status = self.view_status(now);
        PieceInfo {
            piece_id: self.piece_id.clone(),
            token_id: token_id_of(&self.piece_id),
            collection: self.collection.clone(),
            mode: self.mode,
            artist: self.artist.clone(),
            owner: self.owner.clone(),
            rotation_seq: U64(self.rotation_seq),
            status,
            dispute_stage: self.dispute_stage(now),
            transfer_pending: self.transfer_pending.as_ref().map(|p| PendingView {
                from: p.from.clone(),
                to: p.to.clone(),
                seq: U64(p.seq),
                expires_at: U64(p.expires_at),
            }),
            currency: self.cur.currency.clone(),
            price: U128(self.price()),
            royalty_bps: self.royalty_bps,
            grant: self.grant,
            grant_active: status == Status::Settled,
            licence_text_hash: self.licence_text_hash,
            terms_hash: self.terms_hash,
            deadline: U64(self.deadline),
            review_ends_at: self
                .delivered_at
                .zip(self.terms.as_ref())
                .filter(|_| self.status == Status::Delivered)
                .map(|(d, t)| U64(d.saturating_add(t.review_window_ns.0))),
            refund_eligible: self.refund_eligible(now),
            delivered_at: self.delivered_at.map(U64),
            disputed_at: self.disputed_at.map(U64),
            revisions_used: self.revisions_used,
            released_milestones: self.released_milestones,
            final_file_hash: self.final_file_hash,
            report_hash: self.report_hash,
            evidence_level: self.attestation.evidence_level,
            commissioned_badge: {
                let mut c = self.clone();
                c.materialise(now);
                c.badge()
            },
            split: self.split.as_ref().map(|s| SplitView { by: s.by.clone(), artist_bps: s.artist_bps, nonce: s.nonce }),
            pending_addendum: self.pending_addendum.clone(),
            addenda: self.addenda.clone(),
            created_at: U64(self.created_at),
        }
    }

    pub fn accounting_view(&self, near_balance: u128, storage_usage: u64) -> AccountingView {
        AccountingView {
            currency: self.cur.currency.clone(),
            funded: U128(self.funded),
            escrow: U128(self.escrow),
            released: U128(self.released),
            refunded: U128(self.refunded),
            holder_pool: U128(self.holder_pool),
            bond: U128(self.bond),
            liabilities: U128(self.liabilities()),
            credits: self
                .credits
                .iter()
                .map(|(a, s)| CreditView { account: a.clone(), available: U128(s.available), in_flight: U128(s.in_flight) })
                .collect(),
            near_balance: U128(near_balance),
            storage_usage: U64(storage_usage),
        }
    }

    pub fn proof_view(&self, from: u32, limit: u32) -> ProofView {
        let limit = limit.min(MAX_CHALLENGES as u32);
        ProofView {
            segments: self
                .segments
                .iter()
                .map(|s| SegmentView {
                    key: ed25519_pk(&s.key),
                    genesis: genesis(&self.piece_id, &s.key),
                    head: s.head,
                    count: s.count,
                    last_anchor_at: U64(s.last_anchor_at),
                })
                .collect(),
            anchors_total: self.anchors_total,
            segments_digest: self.segments_digest(),
            invites: self.invites.clone(),
            challenges: self
                .challenges
                .iter()
                .enumerate()
                .skip(from as usize)
                .take(limit as usize)
                .map(|(i, c)| ChallengeView {
                    id: i as u32,
                    issuer: c.issuer.clone(),
                    issuer_class: c.issuer_class,
                    nonce_hash: c.nonce_hash,
                    issued_at: U64(c.issued_at),
                    acked_at: c.acked_at.map(U64),
                })
                .collect(),
            challenges_total: self.challenges.len() as u32,
            attestation: AttestationView {
                evidence_level: self.attestation.evidence_level,
                key_id: self.attestation.key_id,
                issued_at: U64(self.attestation.issued_at),
                attested_at: U64(self.attestation.attested_at),
                report_hash: self.attestation.report_hash,
            },
            final_file_hash: self.final_file_hash,
            report_hash: self.report_hash,
        }
    }

    pub fn listing_view(&self) -> Option<ListingView> {
        self.listing.as_ref().map(|l| ListingView {
            seller: l.seller.clone(),
            price: U128(l.price),
            nonce: U64(l.nonce),
            reserved_for: l.reserved_for.clone(),
        })
    }

    pub fn owner_view(&self, now: u64) -> OwnerView {
        OwnerView {
            token_id: token_id_of(&self.piece_id),
            owner: self.owner.clone(),
            seq: U64(self.rotation_seq),
            status: self.view_status(now),
            transfer_pending: self.transfer_pending.is_some(),
        }
    }
}
