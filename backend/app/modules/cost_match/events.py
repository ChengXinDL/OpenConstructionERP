# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Event taxonomy for cost_match.

The two event names are a published contract - subscribers elsewhere bind to
the literal strings - so they are stable. The payload documented under each
one describes what :mod:`app.modules.cost_match.service` actually emits.
"""

from __future__ import annotations

from typing import Final

MATCH_COMPLETED: Final = "cost.match.completed"
"""Emitted once a submitted batch has been scored and persisted. Payload:
``{run_id, project_id, item_count, exact, high_confidence, needs_review,
unmatched, tenant_id}``. The tier counts describe what the matcher found;
none of it is applied to the project until a person rules on it."""

MATCH_REVIEWED: Final = "cost.match.reviewed"
"""Emitted when a person confirms, overrides or rejects one result. Payload:
``{result_id, run_id, project_id, decision, decided_by, tenant_id}`` where
``decision`` is ``confirmed``, ``overridden`` or ``rejected``."""

SOURCE_MODULE: Final = "oe_cost_match"
