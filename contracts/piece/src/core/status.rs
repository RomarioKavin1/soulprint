use super::*;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DisputeStage {
    Negotiation,
    Arbitrator,
    Fallback,
    TimedOut,
}

impl PieceCore {
    fn review_end(&self) -> Option<u64> {
        let t = self.terms.as_ref()?;
        Some(self.delivered_at?.saturating_add(t.review_window_ns.0))
    }

    fn grace_end(&self) -> u64 {
        let grace = self.terms.as_ref().map(|t| t.grace_ns.0).unwrap_or(0);
        self.deadline.saturating_add(grace)
    }

    /// Delivered and the review window `[delivered_at, delivered_at + review)` is still open.
    pub fn review_open(&self, now: u64) -> bool {
        self.status == Status::Delivered && self.review_end().is_some_and(|end| now < end)
    }

    /// InProgress and `[.., deadline + grace)` still open: the artist may deliver.
    pub fn delivery_open(&self, now: u64) -> bool {
        self.status == Status::InProgress && now < self.grace_end()
    }

    /// InProgress and deadline + grace has passed: the owner may claim a refund.
    pub fn refund_eligible(&self, now: u64) -> bool {
        self.status == Status::InProgress && self.mode == Mode::Commission && now >= self.grace_end()
    }

    pub fn dispute_stage(&self, now: u64) -> Option<DisputeStage> {
        if self.status != Status::Disputed {
            return None;
        }
        let d = self.disputed_at?;
        let t = &self.time;
        let a = d.saturating_add(t.negotiation);
        let f = a.saturating_add(t.arbitration);
        let o = f.saturating_add(t.fallback);
        Some(if now < a {
            DisputeStage::Negotiation
        } else if now < f {
            DisputeStage::Arbitrator
        } else if now < o {
            DisputeStage::Fallback
        } else {
            DisputeStage::TimedOut
        })
    }

    /// Pure view of the status after any due transition (equals `materialise` then `status`).
    pub fn view_status(&self, now: u64) -> Status {
        if self.status == Status::Delivered && self.review_end().is_some_and(|end| now >= end) {
            return Status::Settled;
        }
        self.status
    }

    /// A10: perform due transitions including their accounting. Called first by every mutating
    /// entry point. The only stored transition is review lapse → Settled; refund eligibility and
    /// dispute stages are derived from time.
    pub fn materialise(&mut self, now: u64) -> Effects {
        let mut fx = vec![];
        if self.view_status(now) == Status::Settled && self.status == Status::Delivered {
            self.settle_with_remainder(&mut fx);
        }
        fx
    }

    /// Release the remaining escrow to the artist and settle (accept / review lapse).
    pub(crate) fn settle_with_remainder(&mut self, fx: &mut Effects) {
        let rest = self.escrow;
        self.escrow = 0;
        self.released += rest;
        let artist = self.artist.clone();
        self.credit(&artist, rest);
        self.status = Status::Settled;
        self.commissioned = true;
        self.ev(fx, SoulprintEvent::Settled { piece_id: self.piece_id.clone(), artist_amount: U128(rest) });
    }
}
