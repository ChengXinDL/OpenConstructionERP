# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction

"""Make oe_takeoff_measurement.group_color nullable (issue #378).

Since #299 a stored ``group_color`` on a measurement means the user explicitly
recoloured THAT measurement; the client omits the field when they never chose a
colour. The column was NOT NULL with a blue default, so an uncoloured
measurement was persisted as if the user had picked blue, and a cache-less load
painted it blue instead of following the group colour.

This drops the NOT NULL constraint (and the blue server default, if one was
attached) so a create that omits the colour stores a genuine NULL, which the
renderers read as "fall back to the group colour". Existing rows that already
carry a stamped colour are left untouched (backward-compatible): only new
uncoloured rows are NULL. We deliberately do NOT rewrite existing ``#3B82F6``
rows to NULL because a user may have genuinely chosen blue.

Inspector-guarded and idempotent, so a re-run - or a database the embedded
runtime already healed to the current model - is a no-op. PostgreSQL-only.
Chained after v3253_credentials to keep a single linear head.

Revision ID: v3254_takeoff_measurement_color_nullable
Revises: v3253_credentials
Create Date: 2026-07-22
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "v3254_takeoff_measurement_color_nullable"
down_revision = "v3253_credentials"
branch_labels = None
depends_on = None

_TABLE = "oe_takeoff_measurement"
_COLUMN = "group_color"


def _column(table: str, name: str) -> dict | None:
    insp = sa.inspect(op.get_bind())
    if table not in insp.get_table_names():
        return None
    for col in insp.get_columns(table):
        if col.get("name") == name:
            return col
    return None


def upgrade() -> None:
    """Drop NOT NULL + the blue server default on group_color."""
    col = _column(_TABLE, _COLUMN)
    if col is None:
        return
    if col.get("nullable"):
        # Already nullable (fresh create_all install or a re-run): still make
        # sure no blue server_default lingers to re-stamp uncoloured rows.
        op.alter_column(_TABLE, _COLUMN, server_default=None)
        return
    op.alter_column(
        _TABLE,
        _COLUMN,
        existing_type=sa.String(length=20),
        nullable=True,
        server_default=None,
    )


def downgrade() -> None:
    """Restore NOT NULL with the historical blue default.

    Backfill NULLs to the blue hex first so the NOT NULL restore cannot fail.
    """
    col = _column(_TABLE, _COLUMN)
    if col is None or not col.get("nullable"):
        return
    op.execute(sa.text("UPDATE oe_takeoff_measurement SET group_color = '#3B82F6' WHERE group_color IS NULL"))
    op.alter_column(
        _TABLE,
        _COLUMN,
        existing_type=sa.String(length=20),
        nullable=False,
        server_default="#3B82F6",
    )
