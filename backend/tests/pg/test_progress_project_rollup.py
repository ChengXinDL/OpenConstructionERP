"""PG: the project headline percent is a weighted rollup, not the loudest reading.

``/progress`` used to derive a project's cumulative percentage from a single
``MAX(percent_complete)`` grouped by period label alone. Every reading in the
project landed in that one aggregate - project-level manual readings pooled
together with per-position ones - so typing 90 % against one budget line made
a four-hundred-line project read as 90 % complete. That number is not confined
to the page either: it feeds the S-curve and the client-facing progress report.

The replacement rolls the latest per-position reading up to the project,
weighted by BOQ design quantity, and keeps UNMEASURED positions in the
denominator at 0 %. Excluding them would not have fixed anything - one measured
line out of four hundred would still read 90 %.

The second half of the file pins the ``entry_count`` column, which was
hard-coded to 1 for every period and could therefore never show anything else.

Real PostgreSQL because the rollup input is produced by grouped SQL over a
Project -> BOQ -> Position -> ProgressEntry graph with live foreign keys.

Gated by ``OE_TEST_DB=pg`` (see conftest).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.modules.boq.models import BOQ, Position
from app.modules.progress.models import ProgressEntry
from app.modules.progress.service import ProgressService
from app.modules.projects.models import Project
from app.modules.users.models import User

W21 = "2026-W21"
W22 = "2026-W22"


# ── Seeding ────────────────────────────────────────────────────────────────


async def _seed_project(session, name: str = "Rollup project") -> Project:
    """Insert an owner and one project."""
    owner = User(email=f"rollup-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    session.add(owner)
    await session.flush()
    project = Project(name=name, owner_id=owner.id, currency="EUR")
    session.add(project)
    await session.flush()
    return project


def _position(boq_id: uuid.UUID, ordinal: str, quantity: str, *, parent_id: uuid.UUID | None = None) -> Position:
    """One BOQ line carrying a design quantity (stored as a string by design)."""
    return Position(
        boq_id=boq_id,
        parent_id=parent_id,
        ordinal=ordinal,
        description=f"Line {ordinal}",
        unit="m3",
        quantity=quantity,
    )


def _entry(
    project_id: uuid.UUID,
    period_label: str,
    percent: float,
    *,
    position_id: uuid.UUID | None = None,
    recorded_at: datetime | None = None,
) -> ProgressEntry:
    """One progress observation; ``position_id=None`` makes it project-level."""
    return ProgressEntry(
        project_id=project_id,
        boq_position_id=position_id,
        period_label=period_label,
        percent_complete=percent,
        recorded_at=recorded_at or datetime.now(UTC),
    )


async def _seed_boq(session, project: Project, quantities: list[str]) -> list[Position]:
    """Give the project one BOQ holding a flat line per quantity."""
    boq = BOQ(project_id=project.id, name="Main BOQ")
    session.add(boq)
    await session.flush()
    positions = [_position(boq.id, f"01.{i:03d}", qty) for i, qty in enumerate(quantities, start=1)]
    session.add_all(positions)
    await session.flush()
    return positions


async def _project_with_lines(session, quantities: list[str]) -> tuple[Project, list[Position]]:
    """A project whose BOQ holds one line per requested quantity."""
    project = await _seed_project(session)
    positions = await _seed_boq(session, project, quantities)
    return project, positions


# ── Defect 1: the headline percent ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_one_measured_line_cannot_speak_for_the_whole_project(pg_session) -> None:
    """The founder's scenario: 90 % on one line of four is not a 90 % project."""
    project, positions = await _project_with_lines(pg_session, ["100", "100", "100", "100"])
    pg_session.add(_entry(project.id, W21, 90.0, position_id=positions[0].id))
    await pg_session.flush()

    result = await ProgressService(pg_session).get_cumulative(project.id)

    # 90 % of one 100-unit line against 400 units of work in the BOQ.
    assert result.current_cumulative_pct == 22.5
    assert result.current_cumulative_pct != 90.0, "the loudest single reading is not the project"


@pytest.mark.asyncio
async def test_a_project_level_reading_is_not_pooled_with_position_readings(pg_session) -> None:
    """The two scopes are separate series; the old query merged them into one MAX."""
    project, positions = await _project_with_lines(pg_session, ["100", "100"])
    pg_session.add(_entry(project.id, W21, 90.0, position_id=positions[0].id))
    pg_session.add(_entry(project.id, W21, 10.0))  # project-level manual reading
    await pg_session.flush()

    result = await ProgressService(pg_session).get_cumulative(project.id)

    # Positions win when they exist: 90 % of one 100-unit line out of 200 units.
    assert result.current_cumulative_pct == 45.0
    assert result.current_cumulative_pct != 90.0, "pooled MAX across both scopes"


@pytest.mark.asyncio
async def test_the_rollup_weights_readings_by_design_quantity(pg_session) -> None:
    """A big line moving a little outweighs a small line finishing."""
    project, positions = await _project_with_lines(pg_session, ["100", "300"])
    pg_session.add(_entry(project.id, W21, 100.0, position_id=positions[0].id))
    pg_session.add(_entry(project.id, W21, 20.0, position_id=positions[1].id))
    await pg_session.flush()

    result = await ProgressService(pg_session).get_cumulative(project.id)

    # (100 units x 100 % + 300 units x 20 %) / 400 units. A plain mean says 60.
    assert result.current_cumulative_pct == 40.0


@pytest.mark.asyncio
async def test_untracked_positions_stay_in_the_denominator(pg_session) -> None:
    """The fallback boundary: work nobody measured is not work already done."""
    project, positions = await _project_with_lines(pg_session, ["100", "100"])
    pg_session.add(_entry(project.id, W21, 100.0, position_id=positions[0].id))
    await pg_session.flush()

    result = await ProgressService(pg_session).get_cumulative(project.id)

    # One of two equal lines finished. Dropping the unmeasured line from the
    # denominator would report 100 % for a half-built project.
    assert result.current_cumulative_pct == 50.0


@pytest.mark.asyncio
async def test_a_parent_quantity_is_not_counted_on_top_of_its_children(pg_session) -> None:
    """Only leaves carry weight - a parent restates work its children already hold."""
    project = await _seed_project(pg_session)
    boq = BOQ(project_id=project.id, name="Structured BOQ")
    pg_session.add(boq)
    await pg_session.flush()
    parent = _position(boq.id, "01", "1000")
    pg_session.add(parent)
    await pg_session.flush()
    child_a = _position(boq.id, "01.001", "100", parent_id=parent.id)
    child_b = _position(boq.id, "01.002", "100", parent_id=parent.id)
    pg_session.add_all([child_a, child_b])
    await pg_session.flush()
    pg_session.add(_entry(project.id, W21, 100.0, position_id=child_a.id))
    await pg_session.flush()

    result = await ProgressService(pg_session).get_cumulative(project.id)

    # 100 units done out of the 200 units the two leaves hold. Counting the
    # parent's 1000 as well would report 8.333 for the same site.
    assert result.current_cumulative_pct == 50.0


@pytest.mark.asyncio
async def test_a_reading_carries_forward_into_later_periods(pg_session) -> None:
    """A line measured in one week is still built the week after."""
    project, positions = await _project_with_lines(pg_session, ["100", "100"])
    pg_session.add(_entry(project.id, W21, 40.0, position_id=positions[0].id))
    pg_session.add(_entry(project.id, W22, 60.0, position_id=positions[1].id))
    await pg_session.flush()

    result = await ProgressService(pg_session).get_cumulative(project.id)

    # W21: 40 % of one line, nothing on the other. W22: the W21 line still
    # counts, so 40 % and 60 % over two equal lines.
    assert [(p.period_label, p.cumulative_pct) for p in result.periods] == [(W21, 20.0), (W22, 50.0)]
    assert [p.delta_pct for p in result.periods] == [20.0, 30.0]


@pytest.mark.asyncio
async def test_falls_back_to_project_level_entries_when_no_line_was_measured(pg_session) -> None:
    """With nothing measured per position, the manual overall reading is all there is."""
    project, _positions = await _project_with_lines(pg_session, ["100", "100"])
    pg_session.add(_entry(project.id, W21, 35.0))
    await pg_session.flush()

    result = await ProgressService(pg_session).get_cumulative(project.id)

    assert result.current_cumulative_pct == 35.0


@pytest.mark.asyncio
async def test_falls_back_when_readings_point_outside_the_project_boq(pg_session) -> None:
    """Readings on positions this project no longer owns leave no denominator."""
    project, _positions = await _project_with_lines(pg_session, ["100", "100"])
    other_project, other_positions = await _project_with_lines(pg_session, ["100"])
    # A position-level reading filed under this project but pointing at a
    # position that belongs to a different project's BOQ.
    pg_session.add(_entry(project.id, W21, 90.0, position_id=other_positions[0].id))
    pg_session.add(_entry(project.id, W21, 35.0))
    await pg_session.flush()

    result = await ProgressService(pg_session).get_cumulative(project.id)

    assert other_project.id != project.id
    # Neither the orphan reading (90) nor an empty rollup (0) - the documented
    # project-level fallback.
    assert result.current_cumulative_pct == 35.0


@pytest.mark.asyncio
async def test_the_s_curve_actuals_match_the_headline_rollup(pg_session) -> None:
    """The chart and the headline read the same series, so they cannot disagree."""
    project, positions = await _project_with_lines(pg_session, ["100", "100"])
    pg_session.add(_entry(project.id, W21, 40.0, position_id=positions[0].id))
    pg_session.add(_entry(project.id, W22, 60.0, position_id=positions[1].id))
    await pg_session.flush()

    curve = await ProgressService(pg_session).get_s_curve(project.id)

    assert [(p.period_label, p.actual_cumulative_pct) for p in curve.points] == [(W21, 20.0), (W22, 50.0)]


@pytest.mark.asyncio
async def test_a_single_position_series_reports_its_own_readings(pg_session) -> None:
    """Asking for one position still returns that position, not a rollup."""
    project, positions = await _project_with_lines(pg_session, ["100", "100"])
    pg_session.add(_entry(project.id, W21, 40.0, position_id=positions[0].id))
    pg_session.add(_entry(project.id, W22, 70.0, position_id=positions[0].id))
    pg_session.add(_entry(project.id, W22, 5.0, position_id=positions[1].id))
    await pg_session.flush()

    result = await ProgressService(pg_session).get_cumulative(project.id, boq_position_id=positions[0].id)

    assert [p.cumulative_pct for p in result.periods] == [40.0, 70.0]
    assert result.current_cumulative_pct == 70.0


# ── Parent drill-down: pinned, deliberately NOT changed ────────────────────


@pytest.mark.asyncio
async def test_parent_summary_still_rolls_up_measured_children_only(pg_session) -> None:
    """The per-parent panel keeps its own denominator - pinned against drift."""
    project = await _seed_project(pg_session)
    boq = BOQ(project_id=project.id, name="Structured BOQ")
    pg_session.add(boq)
    await pg_session.flush()
    parent = _position(boq.id, "01", "0")
    pg_session.add(parent)
    await pg_session.flush()
    child_a = _position(boq.id, "01.001", "100", parent_id=parent.id)
    child_b = _position(boq.id, "01.002", "300", parent_id=parent.id)
    pg_session.add_all([child_a, child_b])
    await pg_session.flush()
    pg_session.add(_entry(project.id, W21, 100.0, position_id=child_a.id))
    await pg_session.flush()

    summary = await ProgressService(pg_session).get_position_summary(project.id, parent.id)

    assert summary.is_rollup is True
    # Measured children only: the unmeasured 300-unit child is out of the
    # denominator here, unlike the project headline.
    assert summary.current_pct == 100.0


@pytest.mark.asyncio
async def test_parent_summary_falls_back_to_an_unweighted_mean_without_quantities(pg_session) -> None:
    """Zero-quantity children still produce a number, by plain mean."""
    project = await _seed_project(pg_session)
    boq = BOQ(project_id=project.id, name="Unpriced BOQ")
    pg_session.add(boq)
    await pg_session.flush()
    parent = _position(boq.id, "01", "0")
    pg_session.add(parent)
    await pg_session.flush()
    child_a = _position(boq.id, "01.001", "0", parent_id=parent.id)
    child_b = _position(boq.id, "01.002", "0", parent_id=parent.id)
    pg_session.add_all([child_a, child_b])
    await pg_session.flush()
    now = datetime.now(UTC)
    pg_session.add(_entry(project.id, W21, 40.0, position_id=child_a.id, recorded_at=now))
    pg_session.add(_entry(project.id, W21, 60.0, position_id=child_b.id, recorded_at=now + timedelta(minutes=1)))
    await pg_session.flush()

    summary = await ProgressService(pg_session).get_position_summary(project.id, parent.id)

    assert summary.current_pct == 50.0


# ── Defect 2: the Entries column ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_entry_count_reports_the_real_number_of_observations(pg_session) -> None:
    """The column was hard-coded to 1 and could never show anything else."""
    project, positions = await _project_with_lines(pg_session, ["100", "100"])
    pg_session.add(_entry(project.id, W21, 10.0, position_id=positions[0].id))
    pg_session.add(_entry(project.id, W21, 30.0, position_id=positions[0].id))
    pg_session.add(_entry(project.id, W21, 50.0, position_id=positions[1].id))
    pg_session.add(_entry(project.id, W22, 60.0, position_id=positions[0].id))
    await pg_session.flush()

    result = await ProgressService(pg_session).get_cumulative(project.id)

    assert [(p.period_label, p.entry_count) for p in result.periods] == [(W21, 3), (W22, 1)]
    # Two readings for one line inside one period still collapse to the
    # highest, which the rollup then weights: W21 = (30 + 50) / 2 equal lines.
    assert [p.cumulative_pct for p in result.periods] == [40.0, 55.0]


@pytest.mark.asyncio
async def test_entry_count_narrows_to_a_single_position(pg_session) -> None:
    """Filtering by position counts that position's own observations."""
    project, positions = await _project_with_lines(pg_session, ["100", "100"])
    pg_session.add(_entry(project.id, W21, 10.0, position_id=positions[0].id))
    pg_session.add(_entry(project.id, W21, 30.0, position_id=positions[0].id))
    pg_session.add(_entry(project.id, W21, 50.0, position_id=positions[1].id))
    pg_session.add(_entry(project.id, W22, 60.0, position_id=positions[0].id))
    await pg_session.flush()

    result = await ProgressService(pg_session).get_cumulative(project.id, boq_position_id=positions[0].id)

    assert [(p.period_label, p.entry_count) for p in result.periods] == [(W21, 2), (W22, 1)]


@pytest.mark.asyncio
async def test_entry_count_includes_project_level_observations(pg_session) -> None:
    """The column counts observations recorded, whatever scope they carry."""
    project, positions = await _project_with_lines(pg_session, ["100"])
    pg_session.add(_entry(project.id, W21, 40.0, position_id=positions[0].id))
    pg_session.add(_entry(project.id, W21, 45.0))
    await pg_session.flush()

    result = await ProgressService(pg_session).get_cumulative(project.id)

    assert [p.entry_count for p in result.periods] == [2]
    # The percentage still comes from the position rollup alone.
    assert result.current_cumulative_pct == 40.0


@pytest.mark.asyncio
async def test_a_period_with_only_a_project_level_reading_still_appears(pg_session) -> None:
    """Recording an overall percent must not make the week vanish from the table."""
    project, positions = await _project_with_lines(pg_session, ["100", "100"])
    pg_session.add(_entry(project.id, W21, 40.0, position_id=positions[0].id))
    pg_session.add(_entry(project.id, W22, 80.0))
    await pg_session.flush()

    result = await ProgressService(pg_session).get_cumulative(project.id)

    # W22 has an observation, so it has a row. Its percentage carries forward
    # from the position rollup - a manual overall reading is not rollup input.
    assert [(p.period_label, p.cumulative_pct, p.entry_count) for p in result.periods] == [
        (W21, 20.0, 1),
        (W22, 20.0, 1),
    ]


@pytest.mark.asyncio
async def test_a_period_holding_only_an_orphan_reading_still_appears(pg_session) -> None:
    """Same rule for readings pointing at a position outside the project's BOQ."""
    project, positions = await _project_with_lines(pg_session, ["100", "100"])
    other_project, other_positions = await _project_with_lines(pg_session, ["50"])
    pg_session.add(_entry(project.id, W21, 40.0, position_id=positions[0].id))
    pg_session.add(_entry(project.id, W22, 100.0, position_id=other_positions[0].id))
    await pg_session.flush()

    result = await ProgressService(pg_session).get_cumulative(project.id)

    # The orphan cannot move the number - it has no weight in this BOQ - but
    # W22 keeps its row so the discarded observation is visible, not silent.
    assert [(p.period_label, p.cumulative_pct) for p in result.periods] == [(W21, 20.0), (W22, 20.0)]
    assert other_project.id != project.id
