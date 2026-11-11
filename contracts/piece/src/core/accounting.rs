//! Pull payments: credits, in-flight slots, claim / claim_to / withdraw / restore.
use super::*;

impl PieceCore {
    /// Amounts the piece owes and still holds (A43: dispatched in-flight amounts excluded).
    pub fn liabilities(&self) -> u128 {
        self.escrow + self.bond + self.holder_pool + self.credits.values().map(|s| s.available).sum::<u128>()
    }
}
