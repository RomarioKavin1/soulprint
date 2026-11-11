//! reject (with bond), propose/accept split, arbitrator ladder, timeout. Outcome derives from the
//! artist share (A21): ≥ 5000 bps → Settled, client keeps token; < 5000 → Refunded, token → artist.
use super::*;

impl PieceCore {
    pub fn reject_bond(&self) -> u128 {
        self.terms.as_ref().expect("commission").reject_bond()
    }

    /// Owner rejects the delivery within the review window, posting the bond as a value action
    /// (NEAR attached, or FT `reject` action; A14).
    pub fn reject(&mut self, ctx: &Ctx) -> Res {
        let amount = self.value(ctx)?;
        self.require_not_pending()?;
        self.tx(ctx.now, |p, fx| {
            if !p.review_open(ctx.now) {
                return Err(Error::WrongStatus);
            }
            if ctx.predecessor != p.owner {
                return Err(Error::NotOwner);
            }
            let bond = p.reject_bond();
            // A NEAR piece with a zero bond still needs the 1-yocto owner gate.
            let ok = amount == bond || (bond == 0 && ctx.token.is_none() && amount == 1);
            if !ok {
                return Err(Error::WrongAmount);
            }
            p.bond = bond;
            p.bond_payer = Some(ctx.predecessor.clone());
            p.status = Status::Disputed;
            p.disputed_at = Some(ctx.now);
            p.ev(fx, SoulprintEvent::Rejected { piece_id: p.piece_id.clone(), by: ctx.predecessor.clone() });
            p.ev(fx, SoulprintEvent::BondPosted { piece_id: p.piece_id.clone(), by: ctx.predecessor.clone(), amount: U128(bond) });
            Ok(())
        })
    }

    fn require_dispute_party(&self, ctx: &Ctx) -> Res<()> {
        self.require_yocto(ctx)?;
        self.require_not_pending()?;
        if !self.is_party(&ctx.predecessor) {
            return Err(Error::NotParty);
        }
        Ok(())
    }

    pub fn propose_split(&mut self, ctx: &Ctx, artist_bps: u16) -> Res {
        self.require_dispute_party(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if p.status != Status::Disputed {
                return Err(Error::WrongStatus);
            }
            if artist_bps > BPS_DENOM {
                return Err(Error::InvalidBps);
            }
            p.split_nonce += 1;
            p.split = Some(SplitProposal { by: ctx.predecessor.clone(), artist_bps, nonce: p.split_nonce });
            p.ev(fx, SoulprintEvent::SplitProposed {
                piece_id: p.piece_id.clone(),
                by: ctx.predecessor.clone(),
                artist_bps,
                nonce: p.split_nonce,
            });
            Ok(())
        })
    }

    /// A20: allowed in every dispute stage; must match the exact current proposal.
    pub fn accept_split(&mut self, ctx: &Ctx, expected_artist_bps: u16, proposal_nonce: u32) -> Res {
        self.require_dispute_party(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if p.status != Status::Disputed {
                return Err(Error::WrongStatus);
            }
            let s = p.split.clone().ok_or(Error::NoProposal)?;
            if s.by == ctx.predecessor {
                return Err(Error::OwnProposal);
            }
            if s.nonce != proposal_nonce || s.artist_bps != expected_artist_bps {
                return Err(Error::ProposalChanged);
            }
            p.execute_split(fx, s.artist_bps, None);
            Ok(())
        })
    }

    pub fn resolve(&mut self, ctx: &Ctx, artist_bps: u16) -> Res {
        self.require_yocto(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if p.status != Status::Disputed {
                return Err(Error::WrongStatus);
            }
            if artist_bps > BPS_DENOM {
                return Err(Error::InvalidBps);
            }
            let t = p.terms.as_ref().expect("commission");
            let allowed = match p.dispute_stage(ctx.now) {
                Some(DisputeStage::Arbitrator) => &t.arbitrator,
                Some(DisputeStage::Fallback) => &t.fallback_arbitrator,
                _ => return Err(Error::WrongStage),
            };
            if &ctx.predecessor != allowed {
                return Err(Error::NotArbitrator);
            }
            p.execute_split(fx, artist_bps, Some(ctx.predecessor.clone()));
            Ok(())
        })
    }

    /// Anyone, once both arbitrators were silent: split per `terms.timeout_artist_bps` (A22).
    pub fn timeout_resolve(&mut self, ctx: &Ctx) -> Res {
        self.tx(ctx.now, |p, fx| {
            if p.dispute_stage(ctx.now) != Some(DisputeStage::TimedOut) {
                return Err(Error::WrongStage);
            }
            let bps = p.terms.as_ref().expect("commission").timeout_artist_bps;
            p.execute_split(fx, bps, None);
            Ok(())
        })
    }

    fn execute_split(&mut self, fx: &mut Effects, artist_bps: u16, by: Option<AccountId>) {
        let e = self.escrow;
        let b = artist_bps as u128;
        let artist_amount = (e / BPS_DENOM as u128) * b + (e % BPS_DENOM as u128) * b / BPS_DENOM as u128;
        let owner_amount = e - artist_amount;
        let (artist, owner) = (self.artist.clone(), self.owner.clone());
        self.escrow = 0;
        self.released += artist_amount;
        self.refunded += owner_amount;
        self.credit(&artist, artist_amount);
        self.credit(&owner, owner_amount);
        let artist_wins = artist_bps >= BPS_DENOM / 2; // tie → artist
        let bond = core::mem::take(&mut self.bond);
        if bond > 0 {
            let winner = if artist_wins { artist.clone() } else { owner.clone() };
            self.credit(&winner, bond);
            self.ev(fx, SoulprintEvent::BondPaid { piece_id: self.piece_id.clone(), to: winner, amount: U128(bond) });
        }
        self.split = None;
        let outcome = if artist_wins { ResolveOutcome::Settled } else { ResolveOutcome::Refunded };
        self.ev(fx, SoulprintEvent::Resolved {
            piece_id: self.piece_id.clone(),
            by,
            artist_bps,
            artist_amount: U128(artist_amount),
            owner_amount: U128(owner_amount),
            outcome,
        });
        if artist_wins {
            self.status = Status::Settled;
        } else {
            self.status = Status::Refunded;
            self.set_owner(fx, artist, OwnerChangeCause::DisputeRefund, true);
        }
    }
}
