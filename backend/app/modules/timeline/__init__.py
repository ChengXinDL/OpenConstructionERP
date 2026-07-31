# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Project Timeline module.

A unified, cross-module project timeline built on the existing activity-log
store (``oe_activity_log``) - no new table and no migration. Two pieces:

* a *read* service + API that rolls every module's activity up to its umbrella
  project (newest-first, filterable), and
* a *bridge* wildcard subscriber that persists significant domain events from
  the in-memory event bus so the timeline survives a restart.

The module loader auto-mounts ``router`` at ``/api/v1/timeline`` and calls
:func:`on_startup` once at boot.
"""

from app.modules.timeline.router import router

__all__ = ["router", "on_startup"]


async def on_startup() -> None:
    """Module startup hook - register the bridge subscriber and the rules.

    The module loader auto-calls this when the module package is discovered.

    Both registrations belong here. A rule that is only ever registered by a
    test fixture is not registered at all in the running app: the engine
    resolves the rule set to zero rules and reports it as *unsupported*, which
    in the response payload is indistinguishable from "the rules ran and found
    nothing". ``tests/modules/timeline/test_timeline_startup.py`` asserts both
    calls happen here rather than trusting the fixture.
    """
    from app.modules.timeline.events import register_timeline_subscribers
    from app.modules.timeline.validators import register_timeline_rules

    register_timeline_subscribers()
    register_timeline_rules()
