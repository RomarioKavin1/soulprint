//! rotate_owner (collection-initiated NEP-171 transfers), transfer_pending for transfer_call,
//! resolve_transfer, expire_pending (A1, A2). The piece is the source of truth for ownership.
use super::*;

impl PieceCore {
    /// Called by the collection for `nft_transfer` / `nft_transfer_call`. The collection has
    /// checked that `sender` is the predecessor of the NFT call; the piece checks `sender == owner`.
    pub fn rotate_owner(&mut self, ctx: &Ctx, sender: AccountId, receiver: AccountId, call: bool) -> Res {
        self.require_collection(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if p.status != Status::Settled {
                return Err(Error::WrongStatus);
            }
            p.require_not_pending()?;
            if sender != p.owner {
                return Err(Error::NotOwner);
            }
            if receiver == sender || receiver == p.piece_id || receiver == p.collection {
                return Err(Error::InvalidReceiver);
            }
            if p.listing.is_some() {
                return Err(Error::Listed);
            }
            let cause = if call { OwnerChangeCause::TransferCall } else { OwnerChangeCause::Transfer };
            p.set_owner(fx, receiver.clone(), cause, false);
            if call {
                let expires_at = ctx.now.saturating_add(p.time.pending_expiry);
                p.transfer_pending = Some(Pending { from: sender.clone(), to: receiver.clone(), seq: p.rotation_seq, expires_at });
                p.ev(fx, SoulprintEvent::TransferPending {
                    piece_id: p.piece_id.clone(),
                    from: sender,
                    to: receiver,
                    seq: U64(p.rotation_seq),
                    expires_at: U64(expires_at),
                });
            }
            Ok(())
        })
    }

    /// Collection callback after `nft_on_transfer`. Never fails for the collection (A16); with no
    /// pending entry (expired already) it is a no-op (A1). Exempt from listing/dispute blocks.
    /// `seq` = the pending transfer this resolve belongs to (from `rotate_owner`'s result); a resolve
    /// for an earlier transfer is ignored (review minor). `None` = legacy caller, no binding.
    pub fn resolve_transfer(&mut self, ctx: &Ctx, revert: bool, seq: Option<u64>) -> Res {
        self.require_collection(ctx)?;
        let mut fx = vec![];
        if seq.is_some_and(|s| self.transfer_pending.as_ref().is_some_and(|p| p.seq != s)) {
            return Ok(fx);
        }
        let Some(pending) = self.transfer_pending.take() else { return Ok(fx) };
        if revert {
            self.revert_pending(&mut fx, pending, OwnerChangeCause::Revert, false);
        }
        Ok(fx)
    }

    /// Anyone, after `expires_at`: revert to `from` (A1). Single receipt; notifies the collection.
    pub fn expire_pending(&mut self, ctx: &Ctx) -> Res {
        let pending = self.transfer_pending.clone().ok_or(Error::NoTransferPending)?;
        if ctx.now < pending.expires_at {
            return Err(Error::PendingNotExpired);
        }
        let mut fx = vec![];
        self.transfer_pending = None;
        self.revert_pending(&mut fx, pending, OwnerChangeCause::ExpirePending, true);
        Ok(fx)
    }

    fn revert_pending(&mut self, fx: &mut Effects, pending: Pending, cause: OwnerChangeCause, notify: bool) {
        self.set_owner(fx, pending.from.clone(), cause, notify);
        self.ev(fx, SoulprintEvent::TransferReverted {
            piece_id: self.piece_id.clone(),
            to: pending.from,
            seq: U64(self.rotation_seq),
        });
    }
}
