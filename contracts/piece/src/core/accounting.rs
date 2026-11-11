//! Pull payments: credits, in-flight slots, claim / claim_to / withdraw / restore.
use super::*;

impl PieceCore {
    /// Amounts the piece owes and still holds (A43: dispatched in-flight amounts excluded).
    pub fn liabilities(&self) -> u128 {
        self.escrow + self.bond + self.holder_pool + self.credits.values().map(|s| s.available).sum::<u128>()
    }
}

impl PieceCore {
    fn min_claim_gas(&self) -> u64 {
        match self.cur.currency {
            Currency::Near => common::gas::MIN_CLAIM_NEAR.as_gas(),
            Currency::Ft(_) => common::gas::MIN_CLAIM_FT.as_gas(),
        }
    }

    /// Move the creditor's available balance into its in-flight slot and dispatch one transfer.
    fn dispatch(&mut self, fx: &mut Effects, ctx: &Ctx, creditor: &AccountId, recipient: &AccountId) -> Res<()> {
        if ctx.prepaid_gas < self.min_claim_gas() {
            return Err(Error::NotEnoughGas);
        }
        if recipient == &self.piece_id {
            return Err(Error::InvalidRecipient);
        }
        let slot = self.credits.get_mut(creditor).ok_or(Error::NothingToClaim)?;
        if slot.in_flight > 0 {
            return Err(Error::ClaimInFlight);
        }
        if slot.available == 0 {
            return Err(Error::NothingToClaim);
        }
        let amount = core::mem::take(&mut slot.available);
        slot.in_flight = amount;
        let id = SlotId::Credit(creditor.clone());
        fx.push(match &self.cur.currency {
            Currency::Near => Effect::TransferNear { to: recipient.clone(), amount, slot: id },
            Currency::Ft(t) => Effect::TransferFt { token: t.clone(), to: recipient.clone(), amount, slot: id },
        });
        self.ev(fx, SoulprintEvent::Claim {
            piece_id: self.piece_id.clone(),
            creditor: creditor.clone(),
            recipient: recipient.clone(),
            amount: U128(amount),
        });
        Ok(())
    }

    /// Pays the caller's own credit to the caller.
    pub fn claim(&mut self, ctx: &Ctx) -> Res {
        self.tx(ctx.now, |p, fx| p.dispatch(fx, ctx, &ctx.predecessor, &ctx.predecessor))
    }

    /// The creditor redirects its own credit (unregistered / blacklisted FT accounts; A18).
    pub fn claim_to(&mut self, ctx: &Ctx, recipient: AccountId) -> Res {
        self.require_yocto(ctx)?;
        self.tx(ctx.now, |p, fx| p.dispatch(fx, ctx, &ctx.predecessor, &recipient))
    }

    /// Holder pool → owner's credit (one receipt), then a normal claim. A failed claim lands in
    /// the owner's credit, never back in the pool (T3).
    pub fn withdraw(&mut self, ctx: &Ctx) -> Res {
        self.require_owner_action(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if p.status != Status::Settled {
                return Err(Error::WrongStatus);
            }
            if p.listing.is_some() {
                return Err(Error::Listed);
            }
            if p.holder_pool == 0 {
                return Err(Error::PoolEmpty);
            }
            let owner = p.owner.clone();
            if p.credits.get(&owner).is_some_and(|s| s.in_flight > 0) {
                return Err(Error::ClaimInFlight);
            }
            let amount = core::mem::take(&mut p.holder_pool);
            p.credit(&owner, amount);
            p.ev(fx, SoulprintEvent::Withdraw { piece_id: p.piece_id.clone(), owner: owner.clone(), amount: U128(amount) });
            p.dispatch(fx, ctx, &owner, &owner)
        })
    }

    /// Callback for a dispatched transfer (A16): never fails, never checks balances, never grows
    /// storage. Unknown slots or amounts larger than in-flight are ignored / clamped.
    pub fn on_transfer_result(&mut self, slot: SlotId, amount: u128, ok: bool) -> Effects {
        let mut fx = vec![];
        let SlotId::Credit(creditor) = slot;
        let Some(s) = self.credits.get_mut(&creditor) else { return fx };
        let amount = amount.min(s.in_flight);
        s.in_flight -= amount;
        if ok {
            if s.available == 0 && s.in_flight == 0 && !s.prefunded {
                self.credits.remove(&creditor);
            }
        } else {
            s.available += amount;
            self.ev(&mut fx, SoulprintEvent::ClaimRestored { piece_id: self.piece_id.clone(), creditor, amount: U128(amount) });
        }
        fx
    }
}
