//! Signed messages and hash-chain helpers. Field order is normative: Plan 2 (TypeScript)
//! produces identical borsh bytes; test vectors live in `common/test-vectors/`.
use crate::Bytes32;
use near_sdk::{near, AccountId};
use sha2::{Digest, Sha256};

pub const REPORT_DOMAIN: &str = "soulprint-report-v1";
pub const ANCHOR_DOMAIN: &str = "soulprint-anchor-v1";
pub const BATCH_DOMAIN: &str = "soulprint-batch-v1";
pub const CHALLENGE_ACK_DOMAIN: &str = "soulprint-challenge-ack-v1";

pub fn sha256(data: &[u8]) -> Bytes32 {
    Bytes32(Sha256::digest(data).into())
}

/// Genesis of a capture-key segment: sha256(piece_id ‖ capture_pubkey).
pub fn genesis(piece_id: &AccountId, capture_pubkey: &Bytes32) -> Bytes32 {
    let mut h = Sha256::new();
    h.update(piece_id.as_bytes());
    h.update(capture_pubkey.0);
    Bytes32(h.finalize().into())
}

/// link_i = sha256(link_{i-1} ‖ frame_hash_i); link_{-1} = genesis.
pub fn chain_link(prev: &Bytes32, frame_hash: &Bytes32) -> Bytes32 {
    let mut h = Sha256::new();
    h.update(prev.0);
    h.update(frame_hash.0);
    Bytes32(h.finalize().into())
}

/// A44: sha256(borsh(Vec<(key, head, count)>)) over all segments, in key-registration order.
pub fn segments_digest(segments: &[(Bytes32, Bytes32, u32)]) -> Bytes32 {
    sha256(&near_sdk::borsh::to_vec(&segments.to_vec()).expect("borsh"))
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReportMessage {
    pub domain: String,
    pub network: String,
    pub piece_id: AccountId,
    pub final_file_hash: Bytes32,
    pub last_anchor_head: Bytes32,
    pub last_anchor_count: u32,
    pub capture_pubkey: Bytes32,
    pub evidence_level: u8,
    pub report_hash: Bytes32,
    pub issued_at: u64,
    /// A44, appended after the v2.1 fields.
    pub segments_digest: Bytes32,
}

impl ReportMessage {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        network: String,
        piece_id: AccountId,
        final_file_hash: Bytes32,
        last_anchor_head: Bytes32,
        last_anchor_count: u32,
        capture_pubkey: Bytes32,
        evidence_level: u8,
        report_hash: Bytes32,
        issued_at: u64,
        segments_digest: Bytes32,
    ) -> Self {
        Self {
            domain: REPORT_DOMAIN.into(),
            network,
            piece_id,
            final_file_hash,
            last_anchor_head,
            last_anchor_count,
            capture_pubkey,
            evidence_level,
            report_hash,
            issued_at,
            segments_digest,
        }
    }
    pub fn signing_bytes(&self) -> Vec<u8> {
        near_sdk::borsh::to_vec(self).expect("borsh")
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AnchorMessage {
    pub domain: String,
    pub piece_id: AccountId,
    pub head: Bytes32,
    pub count: u32,
}

impl AnchorMessage {
    pub fn new(piece_id: AccountId, head: Bytes32, count: u32) -> Self {
        Self { domain: ANCHOR_DOMAIN.into(), piece_id, head, count }
    }
    pub fn signing_bytes(&self) -> Vec<u8> {
        near_sdk::borsh::to_vec(self).expect("borsh")
    }
}

/// A27: authenticates an upload batch of frames `[from_index, to_index]` of one key segment.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BatchMessage {
    pub domain: String,
    pub piece_id: AccountId,
    pub key: Bytes32,
    pub from_index: u32,
    pub to_index: u32,
    pub head: Bytes32,
}

impl BatchMessage {
    pub fn new(piece_id: AccountId, key: Bytes32, from_index: u32, to_index: u32, head: Bytes32) -> Self {
        Self { domain: BATCH_DOMAIN.into(), piece_id, key, from_index, to_index, head }
    }
    pub fn signing_bytes(&self) -> Vec<u8> {
        near_sdk::borsh::to_vec(self).expect("borsh")
    }
}

/// A28: the capture key acknowledges a challenge; the response window starts at the ack.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChallengeAckMessage {
    pub domain: String,
    pub piece_id: AccountId,
    pub challenge_id: u32,
    pub nonce_hash: Bytes32,
}

impl ChallengeAckMessage {
    pub fn new(piece_id: AccountId, challenge_id: u32, nonce_hash: Bytes32) -> Self {
        Self { domain: CHALLENGE_ACK_DOMAIN.into(), piece_id, challenge_id, nonce_hash }
    }
    pub fn signing_bytes(&self) -> Vec<u8> {
        near_sdk::borsh::to_vec(self).expect("borsh")
    }
}
