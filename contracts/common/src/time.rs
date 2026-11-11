use near_sdk::near;

const SEC: u64 = 1_000_000_000;
const MIN: u64 = 60 * SEC;
const DAY: u64 = 86_400 * SEC;

/// All protocol time constants (A9, A41). Fixed at collection genesis and copied into each piece.
/// Nanoseconds. Production = spec defaults; `fast()` is seconds-scale for sandbox, E2E and soak.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TimeConfig {
    #[serde(with = "crate::time::dec")]
    pub grace_max: u64,
    #[serde(with = "crate::time::dec")]
    pub review_min: u64,
    #[serde(with = "crate::time::dec")]
    pub revision_period_min: u64,
    #[serde(with = "crate::time::dec")]
    pub negotiation: u64,
    #[serde(with = "crate::time::dec")]
    pub arbitration: u64,
    #[serde(with = "crate::time::dec")]
    pub fallback: u64,
    #[serde(with = "crate::time::dec")]
    pub pending_expiry: u64,
    #[serde(with = "crate::time::dec")]
    pub key_timelock: u64,
    #[serde(with = "crate::time::dec")]
    pub challenge_window: u64,
    #[serde(with = "crate::time::dec")]
    pub challenge_min_interval: u64,
    #[serde(with = "crate::time::dec")]
    pub deadline_min_lead: u64,
    #[serde(with = "crate::time::dec")]
    pub deadline_max: u64,
    #[serde(with = "crate::time::dec")]
    pub fund_cutoff: u64,
}

impl TimeConfig {
    pub const fn production() -> Self {
        Self {
            grace_max: 14 * DAY,
            review_min: 3 * DAY,
            revision_period_min: DAY,
            negotiation: 7 * DAY,
            arbitration: 14 * DAY,
            fallback: 14 * DAY,
            pending_expiry: DAY,
            key_timelock: 3 * DAY,
            challenge_window: 10 * MIN,
            challenge_min_interval: 30 * MIN,
            deadline_min_lead: DAY,
            deadline_max: 365 * DAY,
            fund_cutoff: DAY,
        }
    }

    /// Seconds-scale values for sandbox / E2E / soak (A9).
    pub const fn fast() -> Self {
        Self {
            grace_max: 14 * DAY,
            review_min: 20 * SEC,
            revision_period_min: 5 * SEC,
            negotiation: 20 * SEC,
            arbitration: 20 * SEC,
            fallback: 20 * SEC,
            pending_expiry: 30 * SEC,
            key_timelock: 10 * SEC,
            challenge_window: 60 * SEC,
            challenge_min_interval: 5 * SEC,
            deadline_min_lead: 10 * SEC,
            deadline_max: 365 * DAY,
            fund_cutoff: 5 * SEC,
        }
    }
}

/// u64 as a decimal string in JSON (A34).
pub(crate) mod dec {
    use near_sdk::serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &u64, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
        let s = <String as Deserialize>::deserialize(d)?;
        s.parse().map_err(near_sdk::serde::de::Error::custom)
    }
}
