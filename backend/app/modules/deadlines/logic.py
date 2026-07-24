# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Pure deadline logic - no I/O, unit-tested on any Python without a database.

This is the DB-free core of the cross-module deadline register (item #18),
kept separate from the query/normalise layer in :mod:`service` exactly like
``dashboard/inbox_logic.py`` sits under ``dashboard/inbox.py``.

Three helpers:

* :func:`parse_due` - normalise a heterogeneous due value (real ``datetime``,
  ISO date string, ISO datetime string) to a ``date``. Never raises.
* :func:`classify` - date-only overdue/approaching verdict for one row.
* :func:`build_register` - filter + sort + count + cap a list of collected
  items into the register payload, with pre-cap counts.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from app.modules.deadlines.schemas import DeadlineItem, DeadlineRegisterResponse

# ── Classification + severity vocabulary ───────────────────────────────────
OVERDUE = "overdue"
APPROACHING = "approaching"
ON_TIME = "on_time"

SEVERITY_CRITICAL = "critical"
SEVERITY_WARNING = "warning"
SEVERITY_INFO = "info"


def parse_due(raw: object) -> date | None:
    """Normalise a due value to a ``date``, or ``None`` if there is none.

    Sources store the deadline in three shapes: a real ``DateTime`` column
    (punchlist), an ISO date string ``'2026-07-10'`` (correspondence
    ``String(20)``) and an ISO datetime string (NCR action ``String(32)``).
    Returns ``None`` on empty or unparseable input. NEVER raises - a bad
    value means "no deadline", not a crashed register.
    """
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    text = str(raw).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        # A trailing 'Z' (UTC) is the one common ISO form fromisoformat
        # rejects on some interpreters; retry with an explicit offset.
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
        except ValueError:
            return None


def classify(
    due: date | None,
    status: str,
    now_date: date,
    terminal_states: set[str],
    approaching_days: int,
) -> tuple[str, int, str]:
    """Return ``(classification, days_overdue, severity)`` for one row.

    ``days_overdue = (now_date - due).days`` - signed, so ``>0`` is overdue
    and ``<0`` is days-until-due. Date-only arithmetic means an item due
    TODAY is NOT overdue (matches
    ``correspondence/router.py:_compute_correspondence_fields``), which
    avoids the midnight-UTC false positive.

    Terminal rows (``status`` in ``terminal_states``) and rows with no
    parseable deadline are ``on_time`` - they never surface in the register.
    A terminal-EXCLUSION set is used rather than an open-state inclusion set
    because the non-terminal vocabularies are open-ended (an NCR action's only
    confirmed terminal states are ``done``/``cancelled``); the register should
    over-surface an unknown intermediate state rather than silently drop a
    still-open overdue item.
    """
    if due is None or status in terminal_states:
        return ON_TIME, 0, SEVERITY_INFO
    days_overdue = (now_date - due).days
    if days_overdue > 0:
        return OVERDUE, days_overdue, SEVERITY_CRITICAL
    if -days_overdue <= approaching_days:
        # days_overdue <= 0 here, so this is the "due today or within the
        # approaching window" band (0 = due today).
        return APPROACHING, days_overdue, SEVERITY_WARNING
    return ON_TIME, days_overdue, SEVERITY_INFO


def build_register(
    items: list[DeadlineItem],
    *,
    status: str = "all",
    limit: int = 200,
    now: datetime | None = None,
) -> DeadlineRegisterResponse:
    """Filter, sort, count and cap collected items into the register payload.

    ``overdue_count`` / ``approaching_count`` are computed from the full
    classified set BEFORE the status filter and the cap, so the KPI chips
    stay stable as the user switches the all/overdue/approaching tab (mirrors
    the pre-cap counts of ``InboxResponse``). Sort: overdue first, then
    most-overdue first (``days_overdue`` desc), stable by ``id``.
    """
    overdue_count = sum(1 for it in items if it.classification == OVERDUE)
    approaching_count = sum(1 for it in items if it.classification == APPROACHING)

    if status == OVERDUE:
        kept = [it for it in items if it.classification == OVERDUE]
    elif status == APPROACHING:
        kept = [it for it in items if it.classification == APPROACHING]
    else:
        kept = [it for it in items if it.classification in (OVERDUE, APPROACHING)]

    # Overdue rows first (False sorts before True), then most-overdue first
    # (negate the signed days), stable by id for a deterministic order.
    kept.sort(key=lambda it: (it.classification != OVERDUE, -it.days_overdue, it.id))
    if limit >= 0:
        kept = kept[:limit]

    generated = (now or datetime.now(UTC)).isoformat()
    return DeadlineRegisterResponse(
        items=kept,
        overdue_count=overdue_count,
        approaching_count=approaching_count,
        generated_at=generated,
    )
