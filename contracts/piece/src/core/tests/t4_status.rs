use super::*;

/// A funded, delivered piece built by direct state edits (Task 5 adds the real methods).
fn delivered(at: u64) -> PieceCore {
    let mut p = new_piece(&cur_ft());
    p.status = Status::Delivered;
    p.owner = client();
    p.funded = PRICE;
    p.escrow = PRICE;
    p.delivered_at = Some(at);
    p
}

const REVIEW: u64 = 7 * DAY;

#[test]
fn review_window_lapse_makes_settle_eligible() {
    let d = T0 + DAY;
    let p = delivered(d);
    assert_eq!(p.view_status(d + REVIEW - 1), Status::Delivered);
    assert!(p.review_open(d + REVIEW - 1));
    assert_eq!(p.view_status(d + REVIEW), Status::Settled);
    assert!(!p.review_open(d + REVIEW));
}

#[test]
fn materialise_settles_and_credits_artist_on_review_lapse() {
    let d = T0 + DAY;
    let mut p = delivered(d);
    p.released = 30_000_000;
    p.escrow = PRICE - 30_000_000;
    let fx = p.materialise(d + REVIEW - 1);
    assert!(fx.is_empty());
    assert_eq!(p.status, Status::Delivered);
    let fx = p.materialise(d + REVIEW);
    assert_eq!(p.status, Status::Settled);
    assert_eq!(p.escrow, 0);
    assert_eq!(p.released, PRICE);
    assert_eq!(p.credits[&artist()].available, PRICE - 30_000_000);
    assert!(p.commissioned);
    assert!(has_event(&fx, "settled"));
    // Idempotent.
    assert!(p.materialise(d + REVIEW + 5).is_empty());
}

#[test]
fn deadline_plus_grace_opens_refund() {
    let mut p = new_piece(&cur_ft());
    p.status = Status::InProgress;
    p.owner = client();
    let end = p.deadline + 2 * DAY;
    assert!(!p.refund_eligible(end - 1));
    assert!(p.refund_eligible(end));
    assert_eq!(p.view_status(end), Status::InProgress, "refund needs an explicit claim");
}

#[test]
fn dispute_stage_progression_7_21_35_days() {
    let mut p = delivered(T0);
    p.status = Status::Disputed;
    let d = T0 + DAY;
    p.disputed_at = Some(d);
    use DisputeStage::*;
    assert_eq!(p.dispute_stage(d), Some(Negotiation));
    assert_eq!(p.dispute_stage(d + 7 * DAY - 1), Some(Negotiation));
    assert_eq!(p.dispute_stage(d + 7 * DAY), Some(Arbitrator));
    assert_eq!(p.dispute_stage(d + 21 * DAY - 1), Some(Arbitrator));
    assert_eq!(p.dispute_stage(d + 21 * DAY), Some(Fallback));
    assert_eq!(p.dispute_stage(d + 35 * DAY - 1), Some(Fallback));
    assert_eq!(p.dispute_stage(d + 35 * DAY), Some(TimedOut));
    p.status = Status::Settled;
    assert_eq!(p.dispute_stage(d), None);
}

#[test]
fn boundary_times_inclusive_exclusive() {
    // Every window is [start, end): open at end-1, closed at end.
    let d = T0 + DAY;
    let p = delivered(d);
    let review_end = d + REVIEW;
    assert!(p.review_open(review_end - 1) && !p.review_open(review_end));
    assert!(p.review_open(d), "window open at its start");

    let mut q = new_piece(&cur_ft());
    q.status = Status::InProgress;
    let grace_end = q.deadline + 2 * DAY;
    assert!(q.delivery_open(grace_end - 1) && !q.delivery_open(grace_end));
    assert!(!q.refund_eligible(grace_end - 1) && q.refund_eligible(grace_end));

    let mut r = delivered(T0);
    r.status = Status::Disputed;
    r.disputed_at = Some(d);
    for (end, before, after) in [
        (d + 7 * DAY, DisputeStage::Negotiation, DisputeStage::Arbitrator),
        (d + 21 * DAY, DisputeStage::Arbitrator, DisputeStage::Fallback),
        (d + 35 * DAY, DisputeStage::Fallback, DisputeStage::TimedOut),
    ] {
        assert_eq!(r.dispute_stage(end - 1), Some(before));
        assert_eq!(r.dispute_stage(end), Some(after));
    }
}

#[test]
fn views_equal_materialised_status() {
    for offset in [0, REVIEW - 1, REVIEW, REVIEW + 1, 40 * DAY] {
        let d = T0 + DAY;
        let p = delivered(d);
        let mut m = p.clone();
        m.materialise(d + offset);
        assert_eq!(p.view_status(d + offset), m.status, "offset {offset}");
        assert_eq!(m.view_status(d + offset), m.status);
    }
}
