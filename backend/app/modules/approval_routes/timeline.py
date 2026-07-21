# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Held-days / approval-timeline analytics over approval instances.

What this answers
=================
On any regulated document flow the recurring question in a dispute or a
progress review is "who held this, and for how long". An approval instance
already records when it started, when each step was decided and when it
finished; this module turns those timestamps into a plain, auditable timeline:
elapsed time per step (the "held days"), total cycle time, and which steps ran
past their SLA. It is the analytic layer behind the held-days report - the same
question a client asks about a design office, a state reviewer asks about a
submission, or a main contractor asks about a subcontractor.

Design
======
- **Pure and jurisdiction-neutral.** No DB, no network, no clock. The caller
  passes the already-loaded timestamps and the reference "now"; every window
  and threshold is a number of hours, never a country rule. Mirrors the house
  style of :mod:`app.modules.approval_routes.intl`.
- **Held time is measured between hand-offs.** Step 1's clock starts when the
  instance starts; each later step's clock starts when the previous step was
  decided. A step's held time is from its clock-start to its own decision, or
  to the reference time while it is still pending. Out-of-order or missing
  decision timestamps are treated defensively (never negative).
- **Rounding.** Durations are reported in whole hours and in days rounded to
  one decimal so a UI can show "3.5 d" without re-deriving it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

__all__ = [
    "StepHold",
    "Timeline",
    "compute_timeline",
]


@dataclass(frozen=True)
class StepHold:
    """How long one step held the approval."""

    ordinal: int
    decided_at: datetime | None
    held_hours: int
    held_days: float
    sla_hours: int | None
    overdue: bool


@dataclass(frozen=True)
class Timeline:
    """Aggregate timeline for a single approval instance."""

    status: str
    started_at: datetime
    completed_at: datetime | None
    total_hours: int
    total_days: float
    open_hours: int  # elapsed since start while still pending; 0 once complete
    breached_steps: int
    steps: tuple[StepHold, ...]

    def as_dict(self) -> dict:
        """Serialise to a JSON-friendly dict for the API layer."""
        return {
            "status": self.status,
            "started_at": _iso(self.started_at),
            "completed_at": _iso(self.completed_at),
            "total_hours": self.total_hours,
            "total_days": self.total_days,
            "open_hours": self.open_hours,
            "breached_steps": self.breached_steps,
            "steps": [
                {
                    "ordinal": s.ordinal,
                    "decided_at": _iso(s.decided_at),
                    "held_hours": s.held_hours,
                    "held_days": s.held_days,
                    "sla_hours": s.sla_hours,
                    "overdue": s.overdue,
                }
                for s in self.steps
            ],
        }


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _hours_between(start: datetime, end: datetime) -> int:
    """Whole hours from *start* to *end*, never negative."""
    delta = (end - start).total_seconds()
    if delta <= 0:
        return 0
    return int(delta // 3600)


def _to_days(hours: int) -> float:
    return round(hours / 24, 1)


def compute_timeline(
    *,
    status: str,
    started_at: datetime,
    completed_at: datetime | None,
    reference: datetime,
    decisions: list[tuple[int, datetime | None]],
    sla_hours_by_ordinal: dict[int, int | None] | None = None,
) -> Timeline:
    """Build a :class:`Timeline` from one instance's timestamps.

    Args:
        status: The instance status (``pending`` / ``approved`` / ...), echoed
            through so the report can group by it.
        started_at: When the instance began (timezone-aware).
        completed_at: When it finished, or ``None`` while still running.
        reference: The "now" to measure open steps against (timezone-aware).
            Passed in so the function stays clock-free and testable.
        decisions: Ordered ``(ordinal, decided_at)`` pairs, one per step, in
            step order. ``decided_at`` is ``None`` for a step not yet decided.
        sla_hours_by_ordinal: Optional per-step SLA in hours; a step whose held
            time exceeds its SLA is flagged ``overdue``.

    Returns:
        A populated :class:`Timeline`.
    """
    sla_map = sla_hours_by_ordinal or {}
    steps: list[StepHold] = []
    # Each step's clock starts when the previous step was decided; the first
    # step's clock starts when the instance started. A pending step is measured
    # to the reference time.
    clock_start = started_at
    breached = 0
    for ordinal, decided_at in decisions:
        end = decided_at if decided_at is not None else reference
        held_hours = _hours_between(clock_start, end)
        sla = sla_map.get(ordinal)
        overdue = sla is not None and held_hours > sla
        if overdue:
            breached += 1
        steps.append(
            StepHold(
                ordinal=ordinal,
                decided_at=decided_at,
                held_hours=held_hours,
                held_days=_to_days(held_hours),
                sla_hours=sla,
                overdue=overdue,
            )
        )
        # Advance the clock only past a decided step; a pending step blocks the
        # ones after it, so their held time has not started accruing yet.
        if decided_at is not None:
            clock_start = decided_at

    end_for_total = completed_at if completed_at is not None else reference
    total_hours = _hours_between(started_at, end_for_total)
    open_hours = 0 if completed_at is not None else total_hours

    return Timeline(
        status=status,
        started_at=started_at,
        completed_at=completed_at,
        total_hours=total_hours,
        total_days=_to_days(total_hours),
        open_hours=open_hours,
        breached_steps=breached,
        steps=tuple(steps),
    )
