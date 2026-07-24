# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Cross-instance approval-cycle analytics (pure computation).

What this answers
=================
The per-instance held-days report (:mod:`app.modules.approval_routes.timeline`)
answers "who held this one approval, and for how long". A delivery lead asks
the same question across a whole project: which role or which route step is the
recurring bottleneck, what is the project approval rate and cycle time, and how
many steps ran past their SLA. This module reduces many instances into those
numbers. It layers on top of ``compute_timeline`` - every clock and skew rule
lives there, so this module only classifies and reduces.

Design (mirrors :mod:`timeline`)
================================
- **Pure and jurisdiction-neutral.** No DB, no network, no clock. The caller
  passes the already-loaded rows as :class:`InstanceInput`s and a single
  reference "now"; the service layer owns the IO and the reference.
- **Classify each hold before reducing.** ``compute_timeline`` advances its
  internal clock only past a *decided* step, so for a pending instance every
  unreached step after the one it is stuck on reports the *same* held time as
  the current step. Summing those raw holds would inflate every stat and, in
  particular, the SLA-breach headline. We therefore attribute a hold only when
  it is a genuine completed hold (``decided_at`` set) or the single current,
  still-open step (counted toward the live-overdue KPIs only); unreached future
  steps are dropped entirely.
- **Median alongside average.** Hold times are right-skewed - a few very long
  holds - so bottlenecks are ranked by median; the average is reported next to
  it, never instead of it.
"""

from __future__ import annotations

import dataclasses
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from statistics import mean, median

from app.modules.approval_routes.timeline import compute_timeline

__all__ = [
    "AnalyticsResult",
    "Bottleneck",
    "InstanceInput",
    "Kpis",
    "RoleStat",
    "StepMeta",
    "StepStat",
    "aggregate",
]

# Ranking depth of the bottleneck list surfaced to the UI.
_TOP_BOTTLENECKS = 8


# ── Inputs (loaded by the service, no persistence here) ──────────────


@dataclass(frozen=True)
class StepMeta:
    """One route step's identity for attribution."""

    ordinal: int
    approver_role: str | None  # None for a user-pinned step
    sla_hours: int | None


@dataclass(frozen=True)
class InstanceInput:
    """One approval instance, pre-loaded for the pure aggregate."""

    instance_id: str
    route_id: str
    route_name: str
    status: str  # pending | approved | rejected | cancelled
    started_at: datetime
    completed_at: datetime | None
    current_step_ordinal: int
    steps: tuple[StepMeta, ...]  # ordered by ordinal
    decisions: tuple[tuple[int, datetime | None], ...]  # (ordinal, latest decided_at)


# ── Result shapes (1:1 with the response schema) ─────────────────────


@dataclass(frozen=True)
class Kpis:
    """Project-level headline figures."""

    total_instances: int
    pending: int
    approved: int
    rejected: int
    cancelled: int
    approval_rate: float | None  # approved / (approved + rejected); None if no terminal
    avg_cycle_days: float | None  # over approved + rejected only
    median_cycle_days: float | None
    breached_steps_total: int
    instances_with_breach: int
    open_overdue_now: int  # pending instances whose CURRENT step is overdue

    def as_dict(self) -> dict:
        return dataclasses.asdict(self)


@dataclass(frozen=True)
class RoleStat:
    """Held-time stats for every decided step attributed to one role."""

    role: str | None  # approver_role, or None bucket (user-pinned)
    decided_count: int  # decided steps attributed to this role (= throughput)
    avg_hours: float
    median_hours: float
    max_hours: int
    breach_count: int
    breach_rate: float  # breach_count / decided_count (0 when decided_count == 0)

    def as_dict(self) -> dict:
        return dataclasses.asdict(self)


@dataclass(frozen=True)
class StepStat:
    """Held-time stats for one route step (route_id + ordinal)."""

    route_id: str
    route_name: str
    ordinal: int
    approver_role: str | None
    decided_count: int
    avg_hours: float
    median_hours: float
    breach_count: int
    breach_rate: float
    sla_hours: int | None

    def as_dict(self) -> dict:
        return dataclasses.asdict(self)


@dataclass(frozen=True)
class Bottleneck:
    """A ranked slow point - a role or a specific route step."""

    kind: str  # "role" | "step"
    label: str  # role name, or "route_name · Step n"
    ref: str  # role, or f"{route_id}:{ordinal}"
    avg_hours: float
    median_hours: float
    breach_rate: float
    sample_size: int  # decided_count behind the number

    def as_dict(self) -> dict:
        return dataclasses.asdict(self)


@dataclass(frozen=True)
class AnalyticsResult:
    """The full aggregate for one project scope."""

    kpis: Kpis
    by_role: tuple[RoleStat, ...]
    by_step: tuple[StepStat, ...]
    bottlenecks: tuple[Bottleneck, ...]

    def as_dict(self) -> dict:
        return {
            "kpis": self.kpis.as_dict(),
            "by_role": [r.as_dict() for r in self.by_role],
            "by_step": [s.as_dict() for s in self.by_step],
            "bottlenecks": [b.as_dict() for b in self.bottlenecks],
        }


# ── Reductions ───────────────────────────────────────────────────────


def _round1(value: float) -> float:
    """Hours / days to one decimal, matching :func:`timeline._to_days`."""
    return round(float(value), 1)


def _round3(value: float) -> float:
    """Rates to three decimals so an exact 0.75 stays 0.75."""
    return round(float(value), 3)


class _Bucket:
    """Mutable accumulator for one role or one step while reducing."""

    __slots__ = ("hours", "breach_count", "route_name", "approver_role", "sla_hours")

    def __init__(self) -> None:
        self.hours: list[int] = []
        self.breach_count: int = 0
        # Step buckets carry their route identity for the by-step table; role
        # buckets leave these at their defaults.
        self.route_name: str = ""
        self.approver_role: str | None = None
        self.sla_hours: int | None = None


def aggregate(instances: list[InstanceInput], *, reference: datetime) -> AnalyticsResult:
    """Reduce many instances into an :class:`AnalyticsResult`.

    Args:
        instances: The bounded compute set, already loaded by the service.
        reference: The single "now" to measure open steps against. One value
            for the whole aggregate keeps every instance's clock consistent.

    Returns:
        A populated :class:`AnalyticsResult`; empty input yields all zeros /
        ``None`` and empty tuples (never raises).
    """
    role_buckets: dict[str | None, _Bucket] = defaultdict(_Bucket)
    step_buckets: dict[tuple[str, int], _Bucket] = defaultdict(_Bucket)

    status_counts: dict[str, int] = defaultdict(int)
    cycle_days: list[float] = []
    breached_steps_total = 0
    instances_with_breach = 0
    open_overdue_now = 0

    for inst in instances:
        status_counts[inst.status] += 1
        role_by_ordinal = {s.ordinal: s.approver_role for s in inst.steps}
        sla_by_ordinal = {s.ordinal: s.sla_hours for s in inst.steps}

        timeline = compute_timeline(
            status=inst.status,
            started_at=inst.started_at,
            completed_at=inst.completed_at,
            reference=reference,
            decisions=list(inst.decisions),
            sla_hours_by_ordinal=sla_by_ordinal,
        )

        inst_breaches = 0
        for hold in timeline.steps:
            if hold.decided_at is not None:
                # A genuine, completed hold - attribute it to its role + step.
                role = role_by_ordinal.get(hold.ordinal)
                r_bucket = role_buckets[role]
                r_bucket.hours.append(hold.held_hours)
                s_key = (inst.route_id, hold.ordinal)
                s_bucket = step_buckets[s_key]
                s_bucket.hours.append(hold.held_hours)
                if not s_bucket.route_name:
                    s_bucket.route_name = inst.route_name
                    s_bucket.approver_role = role
                    s_bucket.sla_hours = sla_by_ordinal.get(hold.ordinal)
                if hold.overdue:
                    r_bucket.breach_count += 1
                    s_bucket.breach_count += 1
                    inst_breaches += 1
            elif hold.ordinal == inst.current_step_ordinal and inst.status == "pending":
                # The single live step. Count its overdue only toward the
                # instant-in-time KPIs, never the decided-throughput stats.
                if hold.overdue:
                    open_overdue_now += 1
                    inst_breaches += 1
            # else: an unreached future step - its held time is a computation
            # artifact (see the module docstring); drop it.

        breached_steps_total += inst_breaches
        if inst_breaches > 0:
            instances_with_breach += 1

        # Cycle time is only meaningful for a completed decision cycle. A
        # cancel sets completed_at too, so we filter by status, not timestamp.
        if inst.status in ("approved", "rejected"):
            cycle_days.append(timeline.total_days)

    by_role = _reduce_roles(role_buckets)
    by_step = _reduce_steps(step_buckets)

    approved = status_counts.get("approved", 0)
    rejected = status_counts.get("rejected", 0)
    terminal = approved + rejected
    kpis = Kpis(
        total_instances=len(instances),
        pending=status_counts.get("pending", 0),
        approved=approved,
        rejected=rejected,
        cancelled=status_counts.get("cancelled", 0),
        approval_rate=_round3(approved / terminal) if terminal else None,
        avg_cycle_days=_round1(mean(cycle_days)) if cycle_days else None,
        median_cycle_days=_round1(median(cycle_days)) if cycle_days else None,
        breached_steps_total=breached_steps_total,
        instances_with_breach=instances_with_breach,
        open_overdue_now=open_overdue_now,
    )

    bottlenecks = _rank_bottlenecks(by_role, by_step)
    return AnalyticsResult(
        kpis=kpis,
        by_role=tuple(by_role),
        by_step=tuple(by_step),
        bottlenecks=tuple(bottlenecks),
    )


def _reduce_roles(buckets: dict[str | None, _Bucket]) -> list[RoleStat]:
    """One :class:`RoleStat` per role, None (user-pinned) sorted last."""
    out: list[RoleStat] = []
    for role in sorted(buckets, key=lambda r: (r is None, r or "")):
        bucket = buckets[role]
        count = len(bucket.hours)
        out.append(
            RoleStat(
                role=role,
                decided_count=count,
                avg_hours=_round1(mean(bucket.hours)),
                median_hours=_round1(median(bucket.hours)),
                max_hours=max(bucket.hours),
                breach_count=bucket.breach_count,
                breach_rate=_round3(bucket.breach_count / count) if count else 0.0,
            ),
        )
    return out


def _reduce_steps(buckets: dict[tuple[str, int], _Bucket]) -> list[StepStat]:
    """One :class:`StepStat` per (route, ordinal), ordered route then ordinal."""
    out: list[StepStat] = []
    for key in sorted(buckets, key=lambda k: (buckets[k].route_name, k[1])):
        route_id, ordinal = key
        bucket = buckets[key]
        count = len(bucket.hours)
        out.append(
            StepStat(
                route_id=route_id,
                route_name=bucket.route_name,
                ordinal=ordinal,
                approver_role=bucket.approver_role,
                decided_count=count,
                avg_hours=_round1(mean(bucket.hours)),
                median_hours=_round1(median(bucket.hours)),
                breach_count=bucket.breach_count,
                breach_rate=_round3(bucket.breach_count / count) if count else 0.0,
                sla_hours=bucket.sla_hours,
            ),
        )
    return out


def _rank_bottlenecks(by_role: list[RoleStat], by_step: list[StepStat]) -> list[Bottleneck]:
    """Union of role + step buckets, ranked by median held time (desc).

    Median is the deliberate ranking axis for right-skewed hold times; the
    breach rate breaks ties so a slow-and-breaching step outranks a slow-but-
    clean one. Only buckets with at least one decided hold are candidates.
    """
    candidates: list[Bottleneck] = []
    for rs in by_role:
        if rs.decided_count < 1:
            continue
        candidates.append(
            Bottleneck(
                kind="role",
                label=rs.role if rs.role is not None else "Specific user",
                ref=rs.role if rs.role is not None else "",
                avg_hours=rs.avg_hours,
                median_hours=rs.median_hours,
                breach_rate=rs.breach_rate,
                sample_size=rs.decided_count,
            ),
        )
    for ss in by_step:
        if ss.decided_count < 1:
            continue
        candidates.append(
            Bottleneck(
                kind="step",
                label=f"{ss.route_name} · Step {ss.ordinal}",
                ref=f"{ss.route_id}:{ss.ordinal}",
                avg_hours=ss.avg_hours,
                median_hours=ss.median_hours,
                breach_rate=ss.breach_rate,
                sample_size=ss.decided_count,
            ),
        )
    candidates.sort(key=lambda b: (-b.median_hours, -b.breach_rate))
    return candidates[:_TOP_BOTTLENECKS]
