# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Deadlines module.

Cross-module overdue escalation - a read-time register that aggregates
due/overdue work from across modules (correspondence response deadlines, NCR
corrective actions, punch items) into one normalized view, plus a background
sweep that notifies owners, escalates to managers past a grace window, and
rolls repeat overdue items into the existing notification digest.

Aggregation only: this module reads sibling modules and writes solely to the
notification store. It ships no table of its own (dedup + escalation tier
reconstruct migration-free from the notification store).
"""


async def on_startup() -> None:
    """Module startup hook - register permissions."""
    from app.modules.deadlines.permissions import register_deadlines_permissions

    register_deadlines_permissions()
