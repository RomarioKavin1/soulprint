//! Capture keys and anchors (A26), challenges (A28), attestation (A24/A44), addenda (A30).
use super::*;

impl PieceCore {
    pub fn segments_digest(&self) -> Bytes32 {
        let segs: Vec<(Bytes32, Bytes32, u32)> = self.segments.iter().map(|s| (s.key, s.head, s.count)).collect();
        segments_digest(&segs)
    }

    fn recording(&self) -> bool {
        matches!(self.status, Status::Offered | Status::InProgress)
    }

    /// Anyone may submit (e.g. the evidence service): authorised by the capture-key signature.
    pub fn anchor(
        &mut self,
        ctx: &Ctx,
        v: &impl Verifier,
        key: Bytes32,
        head: Bytes32,
        count: u32,
        sig: Bytes64,
    ) -> Res {
        self.tx(ctx.now, |p, fx| {
            if !p.recording() {
                return Err(Error::WrongStatus);
            }
            let i = p.segments.iter().position(|s| s.key == key).ok_or(Error::UnknownKey)?;
            if count <= p.segments[i].count {
                return Err(Error::AnchorNotMonotonic);
            }
            if p.anchors_total >= MAX_ANCHORS {
                return Err(Error::TooManyAnchors);
            }
            let msg = AnchorMessage::new(p.piece_id.clone(), head, count).signing_bytes();
            if !v.ed25519(&sig, &msg, &key) {
                return Err(Error::BadSignature);
            }
            p.anchors_total += 1;
            let s = &mut p.segments[i];
            s.head = head;
            s.count = count;
            s.last_anchor_at = ctx.now;
            p.ev(fx, SoulprintEvent::Anchored { piece_id: p.piece_id.clone(), key: ed25519_pk(&key), head, count });
            Ok(())
        })
    }

    pub fn add_capture_key(&mut self, ctx: &Ctx, key: Bytes32) -> Res {
        self.require_artist_action(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if !matches!(p.status, Status::Offered | Status::InProgress | Status::Delivered) {
                return Err(Error::WrongStatus);
            }
            if p.capture_keys.contains(&key) {
                return Err(Error::DuplicateKey);
            }
            if p.capture_keys.len() >= MAX_CAPTURE_KEYS {
                return Err(Error::TooManyKeys);
            }
            p.capture_keys.push(key);
            p.segments.push(Segment { key, head: genesis(&p.piece_id, &key), count: 0, last_anchor_at: 0 });
            p.ev(fx, SoulprintEvent::CaptureKeyAdded { piece_id: p.piece_id.clone(), key: ed25519_pk(&key) });
            Ok(())
        })
    }

    /// A54: plain artist call.
    pub fn invite_challenger(&mut self, ctx: &Ctx, account: AccountId) -> Res {
        self.require_artist_action(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if account == p.artist || account == p.piece_id {
                return Err(Error::NotChallenger);
            }
            if p.invites.contains(&account) {
                return Err(Error::AlreadyInvited);
            }
            if p.invites.len() >= MAX_INVITES {
                return Err(Error::TooManyInvites);
            }
            p.invites.push(account.clone());
            p.ev(fx, SoulprintEvent::ChallengerInvited { piece_id: p.piece_id.clone(), account });
            Ok(())
        })
    }

    fn challenge_open(&self, c: &Challenge, now: u64) -> bool {
        now < c.acked_at.unwrap_or(c.issued_at).saturating_add(self.time.challenge_window)
    }

    pub fn issue_challenge(&mut self, ctx: &Ctx, nonce_hash: Bytes32) -> Res {
        self.require_yocto(ctx)?;
        self.tx(ctx.now, |p, fx| {
            let who = &ctx.predecessor;
            let class = if p.mode == Mode::Commission && who == &p.owner && p.owner != p.artist {
                IssuerClass::Client
            } else if p.invites.contains(who) {
                IssuerClass::Invited
            } else {
                return Err(Error::NotChallenger);
            };
            let active = match p.mode {
                Mode::Commission => p.status == Status::InProgress,
                Mode::Standalone => p.status == Status::Offered,
            };
            if !active {
                return Err(Error::WrongStatus);
            }
            if let Some(last) = p.challenges.last() {
                if p.challenge_open(last, ctx.now) {
                    return Err(Error::ChallengeOpen);
                }
                if ctx.now < last.issued_at.saturating_add(p.time.challenge_min_interval) {
                    return Err(Error::ChallengeTooSoon);
                }
            }
            if p.challenges.iter().filter(|c| &c.issuer == who).count() >= MAX_CHALLENGES_PER_ISSUER
                || p.challenges.len() >= MAX_CHALLENGES
            {
                return Err(Error::TooManyChallenges);
            }
            let id = p.challenges.len() as u32;
            p.challenges.push(Challenge { issuer: who.clone(), issuer_class: class, nonce_hash, issued_at: ctx.now, acked_at: None });
            p.ev(fx, SoulprintEvent::ChallengeIssued {
                piece_id: p.piece_id.clone(),
                challenge_id: id,
                issuer: who.clone(),
                issuer_class: class,
                nonce_hash,
            });
            Ok(())
        })
    }

    /// A28: a capture key acknowledges (artist is in session); the 10-minute window starts now.
    pub fn ack_challenge(&mut self, ctx: &Ctx, v: &impl Verifier, challenge_id: u32, sig: Bytes64) -> Res {
        self.tx(ctx.now, |p, fx| {
            let c = p.challenges.get(challenge_id as usize).ok_or(Error::NoSuchChallenge)?;
            if c.acked_at.is_some() || ctx.now >= c.issued_at.saturating_add(p.time.challenge_window) {
                return Err(Error::ChallengeClosed);
            }
            let msg = ChallengeAckMessage::new(p.piece_id.clone(), challenge_id, c.nonce_hash).signing_bytes();
            if !p.capture_keys.iter().any(|k| v.ed25519(&sig, &msg, k)) {
                return Err(Error::BadSignature);
            }
            p.challenges[challenge_id as usize].acked_at = Some(ctx.now);
            p.ev(fx, SoulprintEvent::ChallengeAcked { piece_id: p.piece_id.clone(), challenge_id, acked_at: U64(ctx.now) });
            Ok(())
        })
    }

    /// Collection only, after it verified the report signature with key `key_id` (A24).
    pub fn record_attestation(&mut self, ctx: &Ctx, msg: ReportMessage, key_id: u16) -> Res {
        self.require_collection(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if !matches!(p.status, Status::Delivered | Status::Settled) || p.final_file_hash.is_none() {
                return Err(Error::WrongStatus);
            }
            if msg.piece_id != p.piece_id {
                return Err(Error::WrongPiece);
            }
            if Some(msg.final_file_hash) != p.final_file_hash || Some(msg.report_hash) != p.report_hash {
                return Err(Error::ReportMismatch);
            }
            let bound = match msg.evidence_level {
                LEVEL_E0 => msg.last_anchor_head == Bytes32::ZERO && msg.last_anchor_count == 0,
                LEVEL_E2 | LEVEL_E3 => p
                    .segments
                    .iter()
                    .find(|s| s.key == msg.capture_pubkey)
                    .is_some_and(|s| s.head == msg.last_anchor_head && s.count == msg.last_anchor_count && s.count > 0),
                _ => false,
            };
            if !bound || msg.segments_digest != p.segments_digest() {
                return Err(Error::ReportMismatch);
            }
            if msg.issued_at <= p.attestation.issued_at {
                return Err(Error::StaleReport);
            }
            p.attestation = Attestation {
                evidence_level: msg.evidence_level,
                key_id,
                issued_at: msg.issued_at,
                attested_at: ctx.now,
                report_hash: msg.report_hash,
            };
            p.ev(fx, SoulprintEvent::Attested {
                piece_id: p.piece_id.clone(),
                key_id,
                evidence_level: msg.evidence_level,
                report_hash: msg.report_hash,
                issued_at: U64(msg.issued_at),
            });
            Ok(())
        })
    }

    pub fn propose_addendum(&mut self, ctx: &Ctx, grant: Grant, text_hash: Bytes32) -> Res {
        self.require_artist_action(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if !matches!(p.status, Status::InProgress | Status::Delivered | Status::Settled) {
                return Err(Error::WrongStatus);
            }
            if p.listing.is_some() {
                return Err(Error::Listed);
            }
            if !p.grant.is_widened_by(&grant) {
                return Err(Error::AddendumNotWider);
            }
            p.pending_addendum = Some(Addendum { grant, text_hash });
            p.ev(fx, SoulprintEvent::AddendumProposed { piece_id: p.piece_id.clone(), grant, text_hash });
            Ok(())
        })
    }

    /// A49: accept by expected hash; the holder must agree to any widening (T7).
    pub fn accept_addendum(&mut self, ctx: &Ctx, expected_hash: Bytes32) -> Res {
        self.require_owner_action(ctx)?;
        self.tx(ctx.now, |p, fx| {
            if p.listing.is_some() {
                return Err(Error::Listed);
            }
            let a = p.pending_addendum.clone().ok_or(Error::NoAddendum)?;
            if a.text_hash != expected_hash {
                return Err(Error::AddendumChanged);
            }
            if p.addenda.len() >= MAX_ADDENDA {
                return Err(Error::TooManyAddenda);
            }
            if !p.grant.is_widened_by(&a.grant) {
                return Err(Error::AddendumNotWider);
            }
            p.grant = a.grant;
            p.addenda.push(a.clone());
            p.pending_addendum = None;
            p.ev(fx, SoulprintEvent::AddendumAccepted { piece_id: p.piece_id.clone(), grant: a.grant, text_hash: a.text_hash });
            Ok(())
        })
    }
}
