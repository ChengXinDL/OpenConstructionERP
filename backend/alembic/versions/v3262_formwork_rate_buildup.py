# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""formwork: two-part rate build-up and striking time.

A formwork rate has two components and only one of them amortises. The panel
cost is paid once and divided over the reuses; the labour and consumables to
erect and strike are paid on every one of those reuses. Pricing only the first
under-states a concrete-heavy job by the whole of the second.

Adds to ``oe_formwork_system``:

* ``erect_strike_rate`` - per-m2 labour and consumables, charged per use
* ``strip_time_days``   - minimum days from pour to strike, which sets the
                          floor on the pour cycle

Adds to ``oe_formwork_assignment``:

* ``material_unit_cost`` - the amortising half of the computed unit cost
* ``labour_unit_cost``   - the per-use half

Every column is NOT NULL with a zero / one-day ``server_default``, so existing
rows keep the exact totals they had: an erect/strike rate of zero reproduces
the old single-component formula. Idempotent - each column is added only when
the inspector says it is missing, so a fresh install that ran
``Base.metadata.create_all`` first is a no-op here.

The two new assignment columns are left at zero for rows that predate them.
Splitting a historical ``computed_unit_cost`` in SQL would have to invent a
labour component that was never priced, so the split is populated by
re-deriving it from the catalogue instead:
``POST /api/v1/formwork/reprice?project_id=...`` recomputes every assignment
on a project and reports how much moved.

Revision ID: v3262_formwork_rate_buildup
Revises: v3261_inbox_item_state
Create Date: 2026-07-31
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "v3262_formwork_rate_buildup"
down_revision: Union[str, Sequence[str], None] = "v3261_inbox_item_state"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_SYSTEM = "oe_formwork_system"
_ASSIGNMENT = "oe_formwork_assignment"

_NEW_COLUMNS: tuple[tuple[str, str, sa.types.TypeEngine, str], ...] = (
    (_SYSTEM, "erect_strike_rate", sa.Numeric(18, 2), "0"),
    (_SYSTEM, "strip_time_days", sa.Integer(), "1"),
    (_ASSIGNMENT, "material_unit_cost", sa.Numeric(18, 2), "0"),
    (_ASSIGNMENT, "labour_unit_cost", sa.Numeric(18, 2), "0"),
)


def _existing_columns(table: str) -> set[str]:
    """Column names already present on ``table`` (empty when it does not exist)."""
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    cache: dict[str, set[str]] = {}
    for table, column, type_, default in _NEW_COLUMNS:
        if table not in cache:
            cache[table] = _existing_columns(table)
        if not cache[table] or column in cache[table]:
            # Table absent (module never installed) or column already there.
            continue
        op.add_column(
            table,
            sa.Column(column, type_, nullable=False, server_default=default),
        )


def downgrade() -> None:
    cache: dict[str, set[str]] = {}
    for table, column, _type, _default in reversed(_NEW_COLUMNS):
        if table not in cache:
            cache[table] = _existing_columns(table)
        if column in cache[table]:
            op.drop_column(table, column)
