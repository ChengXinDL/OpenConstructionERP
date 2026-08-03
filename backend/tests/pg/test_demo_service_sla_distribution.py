# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""The seeded service desk must not report a 100% SLA breach.

Every ticket the demo shipped had breached, which reads as a broken feature
rather than as a struggling contractor. Two independent causes:

* historical tickets carried a flat four-hour ``sla_due_at`` against a
  one-to-twenty-four-hour resolution, so roughly five in six breached by
  construction;
* open tickets were aged zero to seventy-two hours against a response window
  of fifteen to four hundred and eighty minutes, so nearly all of them were
  already overdue the moment they were written.

The distribution is a property of rows in a database, not of the generator's
return value, so it is checked here rather than beside the seeder. The bands
are deliberately wide: this pins "plausible estate", not one draw of one seed.
"""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import select

from app.modules.service.models import ServiceContract, ServiceTicket
from app.modules.service.seed import seed_service_demo
from app.modules.service.service import compute_sla_response_and_resolution

# Statuses ``ServiceService.scan_sla_breaches`` treats as still running.
_OPEN_STATUSES = ("new", "assigned", "in_progress")


def _iso(value: str | None) -> datetime | None:
    """Parse a stored ISO timestamp, or ``None`` when the column is empty."""
    return datetime.fromisoformat(value) if value else None


@pytest.fixture
async def seeded(pg_session):
    """Run the service demo seeder once and hand back its tickets."""
    await seed_service_demo(pg_session)
    await pg_session.flush()
    tickets = list((await pg_session.execute(select(ServiceTicket))).scalars().all())
    assert tickets, "seeder produced no tickets"
    return tickets


async def test_the_open_queue_is_not_entirely_overdue(seeded) -> None:
    """Most open tickets are inside their response window, a few are not."""
    now = datetime.now(tz=_iso(seeded[0].reported_at).tzinfo)
    open_tickets = [t for t in seeded if t.status in _OPEN_STATUSES]
    assert len(open_tickets) >= 10, f"only {len(open_tickets)} open tickets to judge"

    breached = [t for t in open_tickets if (_iso(t.sla_due_at) or now) < now]
    rate = len(breached) / len(open_tickets)
    assert rate < 0.35, f"{rate:.0%} of the open queue is overdue - the register reads as all-red"
    assert rate > 0.0, "no open ticket is overdue at all - the breach state is unreachable"


async def test_the_history_shows_mostly_met_slas(seeded) -> None:
    """Closed tickets are judged on the resolution clock and mostly meet it."""
    closed = [t for t in seeded if t.status == "closed" and t.resolved_at]
    assert len(closed) >= 100, f"only {len(closed)} closed tickets to judge"

    late = [t for t in closed if (due := _iso(t.resolution_due_at)) is not None and _iso(t.resolved_at) > due]
    rate = len(late) / len(closed)
    assert 0.0 < rate < 0.30, f"{rate:.0%} of closed tickets missed resolution - not a plausible estate"


async def test_no_ticket_is_resolved_before_it_was_raised(seeded) -> None:
    """reported <= resolved <= closed, on every row that has the columns."""
    for t in seeded:
        reported = _iso(t.reported_at)
        assert reported is not None, f"{t.ticket_number} has no reported_at"
        resolved = _iso(t.resolved_at)
        if resolved is not None:
            assert resolved >= reported, f"{t.ticket_number} resolved before it was reported"
        closed = _iso(t.closed_at)
        if closed is not None and resolved is not None:
            assert closed >= resolved, f"{t.ticket_number} closed before it was resolved"


async def test_both_sla_clocks_are_stamped(seeded) -> None:
    """The two-clock view has something to read on every seeded ticket."""
    missing = [t.ticket_number for t in seeded if not t.response_due_at or not t.resolution_due_at]
    assert not missing, f"{len(missing)} tickets carry no SLA clocks, e.g. {missing[:3]}"


async def test_a_ticket_is_measured_against_its_own_contract_tier(pg_session, seeded) -> None:
    """A bronze contract's ticket is not judged by silver's promise.

    The seeder resolved the tier as "gold, or else silver", so every bronze
    contract was measured against a four-hour response instead of eight. The
    windows only differ per tier, so a wrong tier is a wrong deadline.
    """
    contracts = {c.id: c for c in (await pg_session.execute(select(ServiceContract))).scalars().all()}
    from app.modules.service.models import SLADefinition

    slas = {s.id: s for s in (await pg_session.execute(select(SLADefinition))).scalars().all()}

    checked = 0
    for ticket in seeded:
        contract = contracts.get(ticket.contract_id)
        sla = slas.get(contract.sla_definition_id) if contract else None
        if sla is None:
            continue
        expected_response, expected_resolution = compute_sla_response_and_resolution(
            _iso(ticket.reported_at), sla, priority=ticket.priority
        )
        assert _iso(ticket.response_due_at) == expected_response, (
            f"{ticket.ticket_number} on tier {sla.name} carries the wrong response deadline"
        )
        assert _iso(ticket.resolution_due_at) == expected_resolution, (
            f"{ticket.ticket_number} on tier {sla.name} carries the wrong resolution deadline"
        )
        checked += 1
    assert checked >= 100, f"only {checked} tickets had a tier to check"


async def test_every_tier_is_actually_represented(pg_session, seeded) -> None:
    """Guard the assertion above: it proves nothing if only one tier is used."""
    from app.modules.service.models import SLADefinition

    contracts = {c.id: c for c in (await pg_session.execute(select(ServiceContract))).scalars().all()}
    slas = {s.id: s for s in (await pg_session.execute(select(SLADefinition))).scalars().all()}
    tiers = {
        slas[contracts[t.contract_id].sla_definition_id].name
        for t in seeded
        if t.contract_id in contracts and contracts[t.contract_id].sla_definition_id in slas
    }
    assert tiers >= {"gold", "silver", "bronze"}, f"only {sorted(tiers)} appear on seeded tickets"
