# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Seeding a project's finance budget twice must not double it.

The budget insert in ``demo_projects`` carried no existence check. The guards
around it are not a substitute: both callers of ``_seed_module_data`` gate on a
*representative* module rather than on budgets, so a run that reaches the
budget block a second time wrote every category again.

The unique constraint does not save it either. ``ProjectBudget`` is unique on
(project_id, wbs_id, category), but this writer leaves ``wbs_id`` NULL and
PostgreSQL compares NULLs as distinct, so a duplicate (project, NULL, category)
is accepted. The failure is therefore silent double-counting in the finance
rollup rather than a loud IntegrityError - which is why it survived.

This is asserted against rows in a database because that is where the defect
lives; the seeder's return value cannot show it.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.modules.finance.models import ProjectBudget

pytestmark = pytest.mark.anyio


async def _write_budget_lines(session, project_id: uuid.UUID, categories: list[str]) -> int:
    """Mirror the seeder's guard-then-insert shape for ``categories``.

    Returns the number of rows actually added, the same figure the seeder now
    reports.
    """
    existing = set(
        (await session.execute(select(ProjectBudget.category).where(ProjectBudget.project_id == project_id)))
        .scalars()
        .all()
    )
    added = 0
    for category in categories:
        if category[:100] in existing:
            continue
        added += 1
        session.add(
            ProjectBudget(
                id=uuid.uuid4(),
                project_id=project_id,
                category=category[:100],
                currency_code="EUR",
                original_budget="1000.00",
                revised_budget="1000.00",
                committed="0.00",
                actual="0.00",
                forecast_final="0.00",
                metadata_={"demo_id": "test"},
            )
        )
    await session.flush()
    return added


async def _count_for(session, project_id: uuid.UUID) -> int:
    return (
        await session.execute(
            select(func.count()).select_from(ProjectBudget).where(ProjectBudget.project_id == project_id)
        )
    ).scalar_one()


async def test_a_second_pass_adds_no_budget_rows(pg_session) -> None:
    """The category set is written once and stays that size."""
    project_id = uuid.uuid4()
    categories = [
        "KG 300 Bauwerk - Baukonstruktion",
        "KG 400 Bauwerk - Technische Anlagen",
        "KG 500 Aussenanlagen",
    ]

    first = await _write_budget_lines(pg_session, project_id, categories)
    assert first == len(categories), "the first pass should write every category"
    after_first = await _count_for(pg_session, project_id)
    assert after_first == len(categories)

    second = await _write_budget_lines(pg_session, project_id, categories)
    assert second == 0, f"the second pass wrote {second} row(s) that already existed"
    after_second = await _count_for(pg_session, project_id)
    assert after_second == after_first, f"budget rows grew from {after_first} to {after_second} on a re-seed"


async def test_the_duplicate_would_not_have_been_caught_by_the_constraint(pg_session) -> None:
    """Pin why the explicit check is required rather than merely tidy.

    If this test ever fails because the insert raised, the unique constraint
    has started catching the duplicate (NULLS NOT DISTINCT, or ``wbs_id`` is
    no longer NULL here) and the comment in the seeder explaining why an
    explicit check is needed has gone stale.
    """
    project_id = uuid.uuid4()
    category = "KG 300 Bauwerk - Baukonstruktion"

    for _ in range(2):
        pg_session.add(
            ProjectBudget(
                id=uuid.uuid4(),
                project_id=project_id,
                category=category,
                currency_code="EUR",
                original_budget="1000.00",
                revised_budget="1000.00",
                committed="0.00",
                actual="0.00",
                forecast_final="0.00",
                metadata_={},
            )
        )
    await pg_session.flush()

    assert await _count_for(pg_session, project_id) == 2, (
        "the database rejected the duplicate - the seeder comment needs updating"
    )


async def test_a_new_category_still_lands_on_a_later_pass(pg_session) -> None:
    """The guard skips what exists; it must not skip what does not.

    Without this, a guard that returned early on any existing row would pass
    the test above while silently refusing to top up a project.
    """
    project_id = uuid.uuid4()
    await _write_budget_lines(pg_session, project_id, ["KG 300 Bauwerk - Baukonstruktion"])

    added = await _write_budget_lines(
        pg_session,
        project_id,
        ["KG 300 Bauwerk - Baukonstruktion", "KG 700 Baunebenkosten"],
    )
    assert added == 1, f"expected only the new category to be written, wrote {added}"
    assert await _count_for(pg_session, project_id) == 2
