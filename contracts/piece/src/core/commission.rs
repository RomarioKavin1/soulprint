//! fund, deliver, request_changes, release_milestone, accept, settle, claim_refund, cancel,
//! consents (mutual cancel, extend), standalone settle / reopen.
use super::*;

impl PieceCore {
    pub fn fund(&mut self, ctx: &Ctx, expected_terms_hash: Bytes32, beneficiary: Option<AccountId>) -> Res {
        let amount = self.value(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if p.mode != Mode::Commission || p.status != Status::Offered {
                return Err(Error::WrongStatus);
            }
            if p.terms_hash != Some(expected_terms_hash) {
                return Err(Error::TermsChanged);
            }
            let t = p.terms.as_ref().expect("commission");
            if amount != t.price.0 {
                return Err(Error::WrongAmount);
            }
            if ctx.now >= p.deadline.saturating_sub(p.time.fund_cutoff) {
                return Err(Error::FundCutoff);
            }
            let owner = beneficiary.unwrap_or_else(|| ctx.payer.clone());
            let barred = [&p.artist, &t.arbitrator, &t.fallback_arbitrator];
            if barred.contains(&&ctx.payer) || barred.contains(&&owner) || owner == p.piece_id {
                return Err(Error::FunderNotAllowed);
            }
            if let Some(c) = &t.client
                && c != &owner
            {
                return Err(Error::NotNamedClient);
            }
            p.funded = amount;
            p.escrow = amount;
            p.funder = Some(ctx.payer.clone());
            p.status = Status::InProgress;
            p.ev(fx, SoulprintEvent::Funded {
                piece_id: p.piece_id.clone(),
                payer: ctx.payer.clone(),
                owner: owner.clone(),
                amount: U128(amount),
                terms_hash: expected_terms_hash,
            });
            p.set_owner(fx, owner, OwnerChangeCause::Fund, true); // A3
            Ok(())
        })
    }

    pub fn deliver(&mut self, ctx: &Ctx, final_file_hash: Bytes32, report_hash: Bytes32) -> Res {
        self.require_artist_action(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if p.status != Status::InProgress {
                return Err(Error::WrongStatus);
            }
            if !p.delivery_open(ctx.now) {
                return Err(Error::DeadlinePassed);
            }
            p.status = Status::Delivered;
            p.delivered_at = Some(ctx.now);
            p.final_file_hash = Some(final_file_hash);
            p.report_hash = Some(report_hash);
            p.attestation = Attestation::default(); // A24: redeliver clears attestation
            p.ev(fx, SoulprintEvent::Delivered {
                piece_id: p.piece_id.clone(),
                final_file_hash,
                report_hash,
                delivered_at: U64(ctx.now),
            });
            Ok(())
        })
    }

    pub fn request_changes(&mut self, ctx: &Ctx) -> Res {
        self.require_owner_action(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if !p.review_open(ctx.now) {
                return Err(Error::WrongStatus);
            }
            let t = p.terms.as_ref().expect("commission");
            if p.revisions_used >= t.revision_rounds {
                return Err(Error::NoRevisionsLeft);
            }
            p.revisions_used += 1;
            p.deadline = p.deadline.max(ctx.now.saturating_add(t.revision_period_ns.0)); // A11
            p.status = Status::InProgress;
            p.delivered_at = None;
            p.ev(fx, SoulprintEvent::ChangesRequested {
                piece_id: p.piece_id.clone(),
                round: p.revisions_used,
                new_deadline: U64(p.deadline),
            });
            Ok(())
        })
    }

    /// A12: the owner releases the next milestone at any time while InProgress/Delivered.
    /// The last milestone takes the remainder, so rounding never leaves dust.
    pub fn release_milestone(&mut self, ctx: &Ctx, index: u8) -> Res {
        self.require_owner_action(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if !matches!(p.status, Status::InProgress | Status::Delivered) {
                return Err(Error::WrongStatus);
            }
            let t = p.terms.as_ref().expect("commission");
            let n = t.milestones.len() as u8;
            if p.released_milestones >= n {
                return Err(Error::NoMilestonesLeft);
            }
            if index != p.released_milestones {
                return Err(Error::MilestoneOrder);
            }
            let amount = if index + 1 == n {
                p.escrow
            } else {
                (t.price.0 / BPS_DENOM as u128) * t.milestones[index as usize].bps as u128
                    + (t.price.0 % BPS_DENOM as u128) * t.milestones[index as usize].bps as u128 / BPS_DENOM as u128
            }
            .min(p.escrow);
            p.escrow -= amount;
            p.released += amount;
            p.released_milestones += 1;
            let a = p.artist.clone();
            p.credit(&a, amount);
            p.ev(fx, SoulprintEvent::MilestoneReleased { piece_id: p.piece_id.clone(), index, amount: U128(amount) });
            Ok(())
        })
    }

    pub fn accept(&mut self, ctx: &Ctx) -> Res {
        self.require_owner_action(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if p.status != Status::Delivered {
                return Err(Error::WrongStatus);
            }
            p.settle_with_remainder(fx);
            Ok(())
        })
    }

    /// Anyone: run `materialise`; fails if nothing was due.
    pub fn settle(&mut self, ctx: &Ctx) -> Res {
        let was = self.status;
        self.tx(ctx.now, |p, _| {
            if was == Status::Delivered && p.status == Status::Settled {
                Ok(())
            } else if was == Status::Delivered {
                Err(Error::ReviewOpen)
            } else {
                Err(Error::WrongStatus)
            }
        })
    }

    pub fn claim_refund(&mut self, ctx: &Ctx) -> Res {
        self.require_owner_action(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if p.status != Status::InProgress || p.mode != Mode::Commission {
                return Err(Error::WrongStatus);
            }
            if !p.refund_eligible(ctx.now) {
                return Err(Error::RefundNotYet);
            }
            p.refund_remaining(fx, OwnerChangeCause::Refund);
            Ok(())
        })
    }

    /// Remaining escrow → owner; token → artist; grant void.
    pub(crate) fn refund_remaining(&mut self, fx: &mut Effects, cause: OwnerChangeCause) {
        let amount = self.escrow;
        let to = self.owner.clone();
        self.escrow = 0;
        self.refunded += amount;
        self.credit(&to, amount);
        self.status = Status::Refunded;
        self.ev(fx, SoulprintEvent::Refunded { piece_id: self.piece_id.clone(), to, amount: U128(amount) });
        let a = self.artist.clone();
        self.set_owner(fx, a, cause, true);
    }

    pub fn cancel(&mut self, ctx: &Ctx) -> Res {
        self.require_artist_action(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if p.status != Status::Offered || p.mode != Mode::Commission {
                return Err(Error::WrongStatus);
            }
            p.status = Status::Cancelled;
            p.ev(fx, SoulprintEvent::Cancelled { piece_id: p.piece_id.clone() });
            Ok(())
        })
    }

    fn require_party_action(&self, ctx: &Ctx) -> Res<()> {
        self.require_yocto(ctx)?;
        self.require_not_pending()?;
        if !self.is_party(&ctx.predecessor) || self.artist == self.owner {
            return Err(Error::NotParty);
        }
        Ok(())
    }

    /// Both parties consent at the current `rotation_seq` → Refunded (A12).
    pub fn consent_mutual_cancel(&mut self, ctx: &Ctx) -> Res {
        self.require_party_action(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if !matches!(p.status, Status::InProgress | Status::Delivered) {
                return Err(Error::WrongStatus);
            }
            let seq = p.rotation_seq;
            let slot = if ctx.predecessor == p.artist { &mut p.consents.cancel_artist } else { &mut p.consents.cancel_owner };
            if *slot == Some(seq) {
                return Err(Error::AlreadyConsented);
            }
            *slot = Some(seq);
            if p.consents.cancel_artist == Some(seq) && p.consents.cancel_owner == Some(seq) {
                p.refund_remaining(fx, OwnerChangeCause::MutualCancel);
            }
            Ok(())
        })
    }

    pub fn consent_extend(&mut self, ctx: &Ctx, new_deadline: u64) -> Res {
        self.require_party_action(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if p.status != Status::InProgress {
                return Err(Error::WrongStatus);
            }
            if new_deadline <= p.deadline || new_deadline > ctx.now.saturating_add(p.time.deadline_max) {
                return Err(Error::InvalidDeadline);
            }
            let seq = p.rotation_seq;
            if ctx.predecessor == p.artist {
                p.consents.extend_artist = Some((new_deadline, seq));
            } else {
                p.consents.extend_owner = Some((new_deadline, seq));
            }
            if p.consents.extend_artist == Some((new_deadline, seq)) && p.consents.extend_owner == Some((new_deadline, seq)) {
                p.deadline = new_deadline;
                p.consents.extend_artist = None;
                p.consents.extend_owner = None;
                p.ev(fx, SoulprintEvent::DeadlineExtended { piece_id: p.piece_id.clone(), new_deadline: U64(new_deadline) });
            }
            Ok(())
        })
    }

    pub fn settle_standalone(&mut self, ctx: &Ctx, final_file_hash: Bytes32, report_hash: Bytes32) -> Res {
        self.require_artist_action(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if p.mode != Mode::Standalone || p.status != Status::Offered {
                return Err(Error::WrongStatus);
            }
            p.status = Status::Settled;
            p.final_file_hash = Some(final_file_hash);
            p.report_hash = Some(report_hash);
            p.delivered_at = Some(ctx.now);
            p.attestation = Attestation::default();
            p.ev(fx, SoulprintEvent::Settled { piece_id: p.piece_id.clone(), artist_amount: U128(0) });
            Ok(())
        })
    }

    /// A25/N16: after a refund the artist keeps the recorded process as a standalone piece.
    pub fn reopen_as_standalone(&mut self, ctx: &Ctx) -> Res {
        self.require_artist_action(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if p.mode != Mode::Commission || p.status != Status::Refunded || p.owner != p.artist {
                return Err(Error::NotStandaloneEligible);
            }
            p.mode = Mode::Standalone;
            p.status = Status::Offered;
            p.commissioned = false;
            p.final_file_hash = None;
            p.report_hash = None;
            p.delivered_at = None;
            p.attestation = Attestation::default();
            p.ev(fx, SoulprintEvent::ReopenedStandalone { piece_id: p.piece_id.clone() });
            Ok(())
        })
    }
}
