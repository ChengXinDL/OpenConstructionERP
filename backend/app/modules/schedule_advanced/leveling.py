# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Resource leveling - serial-greedy heuristic, FS links only.

Superseded and no longer on any request path. Every endpoint now levels
through :func:`app.modules.resources.resource_engine.level_by_resource_units`,
which honours all four PDM link types, splittable activities, fractional units
and self-overloads. Build on that one; nothing new belongs here.

What is kept here is the reference the equivalence test measures against:
``test_resource_engine.test_fs_only_diff_is_byte_identical_to_shipped_leveler``
runs both over an FS-only network and requires the same diff, which is how the
successor's back-compat claim is checked against something rather than
asserted. That check is worth an unused module; a second maintained leveler
would not be.

Given a CPM-scheduled network and a per-resource ceiling, shift activity
start times forward (never backward) so that at no point in time the
aggregate demand for any resource exceeds its ceiling.

Priority rule (the only one shipped in Slice 1):
    1. Latest-Start ascending (LS asc) - items that MUST start sooner
       win the tie-break.
    2. Total-float ascending - critical activities (float=0) preferred
       over slack-rich ones.
    3. Activity id (string-sorted) - final deterministic tie-break so the
       algorithm is reproducible across runs / OSes.

Returns a dict ``{activity_id: new_es}`` - only includes activities
whose ES changed. Callers can re-run :func:`cpm.compute_cpm` over a
network rebuilt from the shifted activities if they need ES/EF/LS/LF
re-derived after leveling.
"""

from __future__ import annotations

from typing import Any

from app.modules.schedule_advanced.cpm import (
    Activity,
    CPMResult,
    TaskNetwork,
    compute_cpm,
)


def _resource_demand_at(
    day: int,
    schedule: dict[Any, tuple[int, int]],
    activities: dict[Any, Activity],
    resource: str,
) -> int:
    """Sum demand for ``resource`` at the given workday index."""
    demand = 0
    for aid, (start, finish) in schedule.items():
        if start <= day < finish:
            demand += activities[aid].required_resources.get(resource, 0)
    return demand


def _can_place(
    aid: Any,
    start: int,
    activities: dict[Any, Activity],
    schedule: dict[Any, tuple[int, int]],
    resource_limits: dict[str, int],
) -> bool:
    """True iff placing ``aid`` at ``start`` fits every resource ceiling."""
    a = activities[aid]
    if a.duration <= 0:
        return True
    finish = start + a.duration
    for resource, req in a.required_resources.items():
        if req <= 0:
            continue
        limit = resource_limits.get(resource)
        if limit is None:
            # Resource has no ceiling → always fits.
            continue
        for day in range(start, finish):
            current = _resource_demand_at(day, schedule, activities, resource)
            if current + req > limit:
                return False
    return True


def level_by_resource_max(
    network: TaskNetwork,
    cpm_result: dict[Any, CPMResult],
    resource_limits: dict[str, int],
) -> dict[Any, int]:
    """Serial-greedy resource leveling - return shifted ES for changed activities.

    Args:
        network: the activity network.
        cpm_result: pre-computed CPM result (typically from
            :func:`cpm.compute_cpm`). Used both to seed initial ES values
            and to prioritise activities.
        resource_limits: ``{resource_code: max_concurrent_units}``.
            Resources absent from this dict are unconstrained.

    Returns:
        Dict mapping activity_id → new ES. **Only contains entries whose
        ES actually shifted**. Activities that stayed put are omitted so
        callers can detect "no change needed" by an empty dict.

    The algorithm processes activities one at a time in priority order;
    once placed, an activity's start is locked. This guarantees the
    serial-greedy property (no backtracking, no thrashing) at the cost
    of potentially sub-optimal global makespan - acceptable for Slice 1.
    """
    if not cpm_result:
        return {}
    if not resource_limits:
        # Nothing to enforce - return empty diff.
        return {}

    activities: dict[Any, Activity] = {a.id: a for a in network.activities}

    # Stable priority order.
    priority: list[Any] = sorted(
        cpm_result.keys(),
        key=lambda aid: (
            cpm_result[aid].ls,
            cpm_result[aid].total_float,
            str(aid),
        ),
    )

    schedule: dict[Any, tuple[int, int]] = {}
    original_es: dict[Any, int] = {aid: r.es for aid, r in cpm_result.items()}

    for aid in priority:
        a = activities.get(aid)
        if a is None:
            continue
        # Earliest legal start = max(original ES, latest predecessor finish
        # under the in-progress shifted schedule).
        earliest = original_es[aid]
        for p_id, dep_type, lag in network.predecessors(aid):
            if dep_type != "FS":
                # SS / FF / SF are ignored here on purpose - this function is
                # frozen as the FS-only reference. The engine that honours them
                # is resource_engine._earliest_legal_start.
                continue
            if p_id in schedule:
                _, p_finish = schedule[p_id]
                earliest = max(earliest, p_finish + int(lag))

        # Walk forward until we find a day where the resource demand fits.
        # Bound the search to avoid pathological inputs spinning forever.
        # Worst case = original ES + sum(durations) - every activity
        # serialised.
        ceiling = earliest + sum(max(0, x.duration) for x in activities.values()) + 1
        start = earliest
        while start <= ceiling and not _can_place(
            aid,
            start,
            activities,
            schedule,
            resource_limits,
        ):
            start += 1
        schedule[aid] = (start, start + max(0, a.duration))

    # Build the diff - only activities whose ES moved.
    diff: dict[Any, int] = {}
    for aid, (new_start, _finish) in schedule.items():
        if new_start != original_es[aid]:
            diff[aid] = new_start
    return diff


def reschedule_with_leveling(
    network: TaskNetwork,
    resource_limits: dict[str, int],
) -> tuple[dict[Any, CPMResult], dict[Any, int]]:
    """Convenience: run CPM, level, return ``(cpm_result, shifted_es)``.

    Useful for callers that want both pieces in one shot without
    bookkeeping the intermediate CPM result themselves.
    """
    base = compute_cpm(network)
    shifted = level_by_resource_max(network, base, resource_limits)
    return base, shifted
