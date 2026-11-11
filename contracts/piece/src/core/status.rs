use super::*;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DisputeStage {
    Negotiation,
    Arbitrator,
    Fallback,
    TimedOut,
}
