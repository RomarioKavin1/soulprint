//! list / delist / buy (single receipt, T1–T2, T13) and pay_income (A56).
use super::*;

impl PieceCore {
    pub fn list(&mut self, ctx: &Ctx, price: u128, reserved_for: Option<AccountId>) -> Res {
        self.require_owner_action(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if p.status != Status::Settled {
                return Err(Error::WrongStatus);
            }
            if price < p.cur.min_list.0 {
                return Err(Error::PriceTooLow);
            }
            if reserved_for.as_ref() == Some(&p.owner) {
                return Err(Error::BuyerIsSeller);
            }
            p.listing_nonce += 1;
            let nonce = p.listing_nonce;
            p.listing = Some(Listing { seller: p.owner.clone(), price, nonce, reserved_for: reserved_for.clone() });
            p.ev(fx, SoulprintEvent::Listed {
                piece_id: p.piece_id.clone(),
                seller: p.owner.clone(),
                price: U128(price),
                nonce: U64(nonce),
                reserved_for,
            });
            Ok(())
        })
    }

    pub fn delist(&mut self, ctx: &Ctx) -> Res {
        self.require_owner_action(ctx)?;
        self.tx(ctx.now, |p, fx| {
            let l = p.listing.take().ok_or(Error::NotListed)?;
            p.ev(fx, SoulprintEvent::Delisted { piece_id: p.piece_id.clone(), nonce: U64(l.nonce) });
            Ok(())
        })
    }

    /// Value action. Royalty → artist credit, rest → seller credit, owner ← buyer, all in one receipt.
    pub fn buy(&mut self, ctx: &Ctx, nonce: u64, max_price: u128, expected_pool_min: u128) -> Res {
        let amount = self.value(ctx)?;
        self.require_not_pending()?;
        self.tx(ctx.now, |p, fx| {
            if p.status != Status::Settled {
                return Err(Error::WrongStatus);
            }
            let l = p.listing.clone().ok_or(Error::NotListed)?;
            if l.nonce != nonce {
                return Err(Error::ListingChanged);
            }
            if l.price > max_price {
                return Err(Error::PriceTooHigh);
            }
            if amount != l.price {
                return Err(Error::WrongAmount);
            }
            let buyer = ctx.predecessor.clone();
            if buyer == l.seller || buyer == p.owner {
                return Err(Error::BuyerIsSeller);
            }
            if l.reserved_for.as_ref().is_some_and(|r| r != &buyer) {
                return Err(Error::Reserved);
            }
            if buyer == p.piece_id || buyer == p.collection {
                return Err(Error::InvalidReceiver);
            }
            if p.holder_pool < expected_pool_min {
                return Err(Error::PoolBelowExpected);
            }
            let b = p.royalty_bps as u128;
            let royalty = (l.price / BPS_DENOM as u128) * b + (l.price % BPS_DENOM as u128) * b / BPS_DENOM as u128;
            let artist = p.artist.clone();
            p.credit(&artist, royalty);
            p.credit(&l.seller, l.price - royalty);
            p.ev(fx, SoulprintEvent::Sold {
                piece_id: p.piece_id.clone(),
                seller: l.seller.clone(),
                buyer: buyer.clone(),
                price: U128(l.price),
                royalty: U128(royalty),
                nonce: U64(l.nonce),
            });
            p.set_owner(fx, buyer, OwnerChangeCause::Sale, true); // clears listing + consents
            Ok(())
        })
    }

    /// Licence income into the piece; belongs to whoever owns it at `withdraw` time (T2).
    pub fn pay_income(&mut self, ctx: &Ctx) -> Res {
        let amount = self.value(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if p.status != Status::Settled {
                return Err(Error::WrongStatus);
            }
            if p.grant.kind < GrantType::CommercialNonExclusive {
                return Err(Error::IncomeNotLicensed);
            }
            if amount < p.cur.min_income.0 {
                return Err(Error::IncomeTooSmall);
            }
            p.holder_pool += amount;
            p.ev(fx, SoulprintEvent::Income { piece_id: p.piece_id.clone(), payer: ctx.payer.clone(), amount: U128(amount) });
            Ok(())
        })
    }
}
