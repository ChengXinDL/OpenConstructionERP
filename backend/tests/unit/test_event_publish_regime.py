# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Guard the synchronous-publish contract unit tests are written against.

``tests/conftest.py`` replaces ``event_bus.publish_detached`` so a test can call
a service and assert on its own recorder on the very next line, with no await in
between. That shim picks its regime from what is on the bus: one subscriber
doing real async I/O pushes the whole publish onto the event loop, and every
pure recorder goes with it.

The bug this file guards: an earlier test subscribed such a handler and never
unsubscribed, so from that point on every unit test relying on the synchronous
contract asserted against an empty recorder. The symptom appeared in an
unrelated module, hundreds of tests away from the cause, and vanished whenever
that file was run on its own.
"""

import asyncio

import pytest

from app.core.events import event_bus


async def _record_event(event):
    """Stand-in for the timeline bridge, a wildcard subscriber that does real I/O.

    The function NAME is load bearing. ``tests/conftest.py`` classifies handlers
    by ``__name__`` against ``_ASYNC_IO_EVENT_HANDLERS``, so renaming this makes
    the test pass for the wrong reason: it would no longer look like the leak it
    is meant to stand in for.
    """
    await asyncio.sleep(0)


@pytest.fixture(scope="module", autouse=True)
def _leaked_io_subscriber():
    """Leave a real-I/O wildcard handler on the bus, the way the bug did.

    Module scope on purpose: it is registered once and stays registered across
    the tests below, which is what makes this a leak rather than a setup step.
    It is removed at the end so this file is a better citizen than the bug it
    describes. That removal doubles as the check that the guard restores what it
    borrows: ``unsubscribe`` raises ``ValueError`` if the handler is not back on
    the bus, so a guard that confiscated it instead of borrowing it would error
    here rather than pass quietly.
    """
    event_bus.subscribe("*", _record_event)
    yield
    event_bus.unsubscribe("*", _record_event)


async def test_recorder_runs_in_line_despite_a_leaked_io_handler():
    seen: list[str] = []

    async def recorder(event):
        seen.append(event.name)

    event_bus.subscribe("*", recorder)
    try:
        event_bus.publish_detached("regime.probe", {"n": 1})
        # Deliberately no await before the assertion. That gap is the whole
        # contract: a sleep here would make this test pass with the guard
        # removed, which is exactly what it must not do.
        assert seen == ["regime.probe"]
    finally:
        event_bus.unsubscribe("*", recorder)


async def test_the_leaked_handler_is_off_the_bus_inside_a_unit_test():
    """State the mechanism, not just its effect.

    The handler is subscribed for the whole module, yet a unit test must not see
    it, because a unit test never started the app that owns it.
    """
    assert _record_event not in event_bus._wildcard_handlers


async def test_delivery_happens_once_not_twice():
    seen: list[str] = []

    async def recorder(event):
        seen.append(event.name)

    event_bus.subscribe("*", recorder)
    try:
        event_bus.publish_detached("regime.probe.solo", {})
        assert seen == ["regime.probe.solo"]
    finally:
        event_bus.unsubscribe("*", recorder)

    await asyncio.sleep(0)
    assert seen == ["regime.probe.solo"]
