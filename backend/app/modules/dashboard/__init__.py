# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Dashboard rollup module - single endpoint that returns all dashboard
widget payloads in one round-trip, eliminating the per-project fan-out
the frontend used to do (N requests for N projects per widget).

Also home to the unified approvals/alerts inbox: the aggregation in
``inbox.py``, and the per-user acknowledge / dismiss state in
``inbox_actions.py`` that lets somebody actually clear a row.

Module name: ``oe_dashboard`` (singular) - distinct from ``oe_dashboards``
(plural, analytical Parquet/DuckDB dashboards). Mounted at
``/api/v1/dashboard/`` by the module loader.
"""


async def on_startup() -> None:
    """Module startup hook (called by the module loader after mount).

    Registers the inbox-action validation rules under the ``inbox_action``
    rule set, which is the set
    :class:`app.modules.dashboard.inbox_actions.InboxActionService` passes to
    the engine on every write. Without this call the set resolves to nothing
    and every action would report a clean result having checked nothing at
    all. Idempotent - the registry overwrites a rule by id, so a hot reload
    re-registers cleanly.
    """
    from app.modules.dashboard.validators import register_inbox_action_rules

    register_inbox_action_rules()
