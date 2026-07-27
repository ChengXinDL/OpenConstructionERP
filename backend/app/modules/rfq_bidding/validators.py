# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Pure completeness and comparability checks for an RFQ and its bids.

Validation is first-class for this module (platform principle #4). An RFQ has
two moments that cannot be taken back. Publishing sends the package to vendors,
who then spend real estimating hours on it; a package that was unpriceable or
already closed wastes their time and returns nothing usable. Awarding turns one
of the returned numbers into the basis of a purchase order or a subcontract,
which means the comparison that picked it has to have been a comparison of like
with like.

The two moments ask different questions, so they are two rule sets:

``rfq_issue``
    Everything a vendor needs in order to bid at all, including whether the
    submission deadline is still in the future. Run from
    :meth:`RFQBiddingService.issue_rfq`.

``rfq_award``
    Everything the comparison between bids relies on. Run from
    :meth:`RFQBiddingService.award_bid`. The deadline-in-the-future check is
    deliberately absent here: by award time the deadline has passed on purpose,
    and a rule that failed for that reason would fail every award forever.

Splitting the sets rather than passing an ``operation`` flag into the payload is
deliberate. A rule whose behaviour depends on a string the caller supplies is
the same hazard as a rule registered into a set nobody calls: it is reachable on
paper and dormant in practice, and no reachability test can tell the difference.
Two named sets each have a named caller.

Like ``procurement/validators.py`` this module is deliberately
**dependency-free**: standard library plus :class:`~decimal.Decimal`, no ORM, no
FastAPI, no session.

The clock is data, never ``date.today()``
-----------------------------------------
:data:`AS_OF_KEY` carries the date the checks treat as today. The service fills
it; a test passes it explicitly.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

#: Payload key carrying the date the checks should consider "now".
AS_OF_KEY = "as_of"

#: Fewer bids than this on an award is a single-source decision in all but name.
#: Three quotations is the common threshold in public and corporate procurement
#: policy alike, which is why it is the number worth flagging against.
MIN_COMPETITIVE_BIDS = 3


@dataclass(frozen=True)
class Finding:
    """One failed check on one element.

    :param element_ref: what the user should look at -- the RFQ number, or the
        bidder on a bid-level finding. Never ``None``: a finding the UI cannot
        anchor is a finding the user cannot act on.
    :param params: placeholders for the translated message, pre-formatted as
        strings so the message layer never formats dates or money itself.
    :param details: machine-readable context for the report payload.
    """

    element_ref: str
    params: dict[str, str] = field(default_factory=dict)
    details: dict[str, Any] = field(default_factory=dict)


def parse_money(raw: Any) -> Decimal | None:
    """Parse a Decimal-string amount, or ``None`` when it is not a number."""
    if raw is None:
        return None
    if isinstance(raw, Decimal):
        return raw
    try:
        return Decimal(str(raw).strip())
    except (InvalidOperation, ValueError, TypeError):
        return None


def parse_date(raw: Any) -> date | None:
    """Parse a date or the date part of an ISO datetime, or ``None``.

    ``submission_deadline`` and ``submitted_at`` are free-form string columns
    holding either a date or a full ISO timestamp, with or without a ``Z``
    suffix. Both shapes are accepted; a value that is neither is reported by
    :func:`check_deadline_parseable` rather than silently treated as absent.
    """
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        pass
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _as_of(rfq: dict[str, Any]) -> date | None:
    """The date the checks treat as today, or ``None`` when the caller omitted it."""
    return parse_date(rfq.get(AS_OF_KEY))


def _ref(rfq: dict[str, Any]) -> str:
    return str(rfq.get("rfq_number") or rfq.get("title") or rfq.get("id") or "?")


def _bids(rfq: dict[str, Any]) -> list[dict[str, Any]]:
    bids = rfq.get("bids")
    return [b for b in bids if isinstance(b, dict)] if isinstance(bids, list) else []


def _recipients(rfq: dict[str, Any]) -> list[Any]:
    contacts = rfq.get("issued_to_contacts")
    return [c for c in contacts if str(c or "").strip()] if isinstance(contacts, list) else []


def bid_label(index: int, bid: dict[str, Any]) -> str:
    """A human bid label: the 1-based row number plus the bidder reference."""
    bidder = str(bid.get("bidder_contact_id") or "").strip()
    if not bidder:
        return str(index + 1)
    if len(bidder) > 40:
        bidder = bidder[:37] + "..."
    return f"{index + 1} ({bidder})"


# ── Checks: what a vendor needs in order to bid ──────────────────────────────


def check_scope_described(rfq: dict[str, Any]) -> list[Finding]:
    """An RFQ must say what is being priced.

    A title alone is a subject line, not a scope. Vendors either decline, or
    price their own guess at the scope, which produces bids that cannot be
    compared with each other and a winner chosen on the narrowest assumption
    rather than the best offer.
    """
    if str(rfq.get("scope_of_work") or "").strip() or str(rfq.get("description") or "").strip():
        return []
    return [Finding(element_ref=_ref(rfq), details={"scope_of_work": None, "description": None})]


def check_deadline_present(rfq: dict[str, Any]) -> list[Finding]:
    """A published RFQ must state when bids close.

    Without a deadline there is no moment at which the field is complete, so the
    comparison happens whenever somebody decides to look and a bid that arrives
    afterwards has no principled answer.
    """
    if str(rfq.get("submission_deadline") or "").strip():
        return []
    return [Finding(element_ref=_ref(rfq), details={"submission_deadline": None})]


def check_deadline_parseable(rfq: dict[str, Any]) -> list[Finding]:
    """The deadline must be a date the system can actually read.

    ``submit_bid`` refuses every bid with HTTP 422 when it cannot parse this
    column. That refusal lands on the vendor, after the package went out, for a
    data-quality problem on our side. Publishing is when it costs nothing to
    fix. Reported only when a deadline exists: an absent one is
    :func:`check_deadline_present`'s finding, not this rule's.
    """
    raw = str(rfq.get("submission_deadline") or "").strip()
    if not raw or parse_date(raw) is not None:
        return []
    return [
        Finding(
            element_ref=_ref(rfq),
            params={"value": raw[:40]},
            details={"submission_deadline": raw},
        )
    ]


def check_deadline_in_future(rfq: dict[str, Any]) -> list[Finding]:
    """Bids must still be open at the moment the RFQ goes out.

    Publishing with a deadline already past means the package arrives closed:
    ``submit_bid`` rejects every response with HTTP 409, so the RFQ collects
    nothing and the buyer waits for bids that were refused on arrival.
    """
    deadline = parse_date(rfq.get("submission_deadline"))
    as_of = _as_of(rfq)
    if deadline is None or as_of is None or deadline >= as_of:
        return []
    return [
        Finding(
            element_ref=_ref(rfq),
            params={"deadline": deadline.isoformat(), "today": as_of.isoformat()},
            details={"submission_deadline": deadline.isoformat(), "as_of": as_of.isoformat()},
        )
    ]


def check_has_recipients(rfq: dict[str, Any]) -> list[Finding]:
    """A published RFQ must be addressed to somebody.

    Publishing to an empty recipient list changes the status and notifies no
    vendor, so the RFQ sits open and unanswered while it reads as issued on
    every dashboard.
    """
    if _recipients(rfq):
        return []
    return [Finding(element_ref=_ref(rfq), details={"issued_to_contacts": []})]


def check_currency_set(rfq: dict[str, Any]) -> list[Finding]:
    """The RFQ must state the currency bids are to be priced in.

    Bids are ranked by amount. Without a stated currency each vendor answers in
    its own and the ranking compares numbers that are not the same money.
    """
    if str(rfq.get("currency_code") or "").strip():
        return []
    return [Finding(element_ref=_ref(rfq), details={"currency_code": ""})]


# ── Checks: what the comparison between bids relies on ───────────────────────


def check_bid_currency_matches(rfq: dict[str, Any]) -> list[Finding]:
    """Every bid must be priced in the RFQ's currency.

    A bid in another currency sorts by its raw number against bids that are not
    the same money, so the cheapest row on screen may be the most expensive
    offer. The platform never converts silently, and an award taken from that
    table is an award taken from a comparison that did not happen.
    """
    currency = str(rfq.get("currency_code") or "").strip().upper()
    if not currency:
        # No RFQ currency to compare against: :func:`check_currency_set` owns
        # that finding, and reporting every bid against a blank would bury it.
        return []
    findings: list[Finding] = []
    for index, bid in enumerate(_bids(rfq)):
        bid_currency = str(bid.get("currency_code") or "").strip().upper()
        if bid_currency and bid_currency != currency:
            findings.append(
                Finding(
                    element_ref=bid_label(index, bid),
                    params={
                        "bid": bid_label(index, bid),
                        "bid_currency": bid_currency,
                        "rfq_currency": currency,
                    },
                    details={"bid_currency": bid_currency, "rfq_currency": currency},
                )
            )
    return findings


def check_bid_amounts_parseable(rfq: dict[str, Any]) -> list[Finding]:
    """Every bid amount must be a number.

    ``bid_amount`` is a free-form string column. A value that is not a number
    cannot be ranked, so it either drops out of the comparison or sorts
    somewhere arbitrary, and in both cases the award was decided over an
    incomplete field without anyone being told.
    """
    findings: list[Finding] = []
    for index, bid in enumerate(_bids(rfq)):
        amount = parse_money(bid.get("bid_amount"))
        if amount is None or amount <= 0:
            findings.append(
                Finding(
                    element_ref=bid_label(index, bid),
                    params={
                        "bid": bid_label(index, bid),
                        "value": str(bid.get("bid_amount") or "")[:40] or "?",
                    },
                    details={"bid_amount": bid.get("bid_amount")},
                )
            )
    return findings


def check_bids_still_valid(rfq: dict[str, Any]) -> list[Finding]:
    """A bid should still be inside its validity period when it is awarded.

    Every bid carries ``validity_days`` from its submission, and past that the
    price is an expression of interest rather than an offer. Awarding an expired
    bid invites a repricing before the contract is signed, which is exactly what
    the tender was meant to avoid. WARNING: a vendor will often honour a lapsed
    price, and that is a conversation rather than a refusal.
    """
    as_of = _as_of(rfq)
    if as_of is None:
        return []
    findings: list[Finding] = []
    for index, bid in enumerate(_bids(rfq)):
        submitted = parse_date(bid.get("submitted_at"))
        if submitted is None:
            continue
        try:
            validity = int(bid.get("validity_days") or 0)
        except (TypeError, ValueError):
            continue
        if validity <= 0:
            continue
        expires = submitted + timedelta(days=validity)
        if expires >= as_of:
            continue
        findings.append(
            Finding(
                element_ref=bid_label(index, bid),
                params={
                    "bid": bid_label(index, bid),
                    "expired": expires.isoformat(),
                    "today": as_of.isoformat(),
                },
                details={
                    "submitted_at": submitted.isoformat(),
                    "validity_days": validity,
                    "expires_on": expires.isoformat(),
                },
            )
        )
    return findings


def check_award_has_competition(rfq: dict[str, Any]) -> list[Finding]:
    """An award should rest on a field of bids, not on one.

    Awarding against fewer than :data:`MIN_COMPETITIVE_BIDS` responses is a
    single-source decision, which most procurement policies allow but require
    somebody to justify in writing. WARNING, so the justification is a
    deliberate act rather than something nobody noticed was needed.
    """
    count = len(_bids(rfq))
    if count >= MIN_COMPETITIVE_BIDS:
        return []
    return [
        Finding(
            element_ref=_ref(rfq),
            params={"count": str(count), "minimum": str(MIN_COMPETITIVE_BIDS)},
            details={"bid_count": count, "minimum": MIN_COMPETITIVE_BIDS},
        )
    ]
