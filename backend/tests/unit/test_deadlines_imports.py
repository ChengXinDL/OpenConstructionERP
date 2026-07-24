# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""DB-free import smoke test for the deadlines module (item #18).

The pure-logic test cannot catch an import typo, a bad symbol, or a circular
import in the impure files (service / router / sweeper), and a broken router
import does NOT crash the app - the module loader swallows it and silently
fails to mount. This asserts every impure file imports and the router object
exists with both endpoints.

Engine creation is lazy and sibling-model imports are deferred inside the
collectors, so importing these modules touches no database.

Run:
    cd backend
    python -m pytest tests/unit/test_deadlines_imports.py -q
"""

from __future__ import annotations


def test_router_module_exposes_router() -> None:
    from fastapi import APIRouter

    from app.modules.deadlines import router as router_mod

    assert isinstance(router_mod.router, APIRouter)
    paths = {getattr(r, "path", None) for r in router_mod.router.routes}
    assert "/" in paths
    assert "/sweep" in paths


def test_service_symbols_present() -> None:
    from app.modules.deadlines import service

    assert callable(service.compute_deadlines)
    assert callable(service.collect_overdue_for_sweep)
    # Collector registry is well-formed (module_key, collector, owns_sweep).
    assert [m for m, _c, _o in service._COLLECTORS] == [
        "correspondence",
        "qms_ncr_action",
        "punchlist",
    ]


def test_sweeper_symbols_present() -> None:
    from app.modules.deadlines import sweeper

    assert callable(sweeper.sweep_overdue)
    assert callable(sweeper.start_deadline_sweeper)
    assert sweeper.OVERDUE_TYPE == "deadline_overdue"
    assert sweeper.ESCALATED_TYPE == "deadline_escalated"


def test_manifest_and_permissions_import() -> None:
    from app.modules.deadlines.manifest import manifest
    from app.modules.deadlines.permissions import register_deadlines_permissions

    assert manifest.name == "oe_deadlines"
    assert callable(register_deadlines_permissions)


def test_notification_templates_registered() -> None:
    # The sweeper's title/body keys must have server-side English fallbacks.
    from app.modules.notifications.templates import icon_category_for, render

    assert render("notifications.deadline.overdue.title", {"title": "Door 12"}) == "Overdue: Door 12"
    body = render(
        "notifications.deadline.overdue.body",
        {"module": "punchlist", "title": "Door 12", "days_overdue": 3},
    )
    assert "3 day(s) past due" in body
    assert icon_category_for("deadline_overdue") == "warning"
    assert icon_category_for("deadline_escalated") == "error"


def test_event_types_registered() -> None:
    from app.modules.notifications.service import KNOWN_EVENT_TYPES

    etypes = {e["event_type"] for e in KNOWN_EVENT_TYPES}
    assert "deadlines.correspondence.overdue" in etypes
    assert "deadlines.qms_ncr_action.overdue" in etypes
    assert "deadlines.punchlist.overdue" in etypes
