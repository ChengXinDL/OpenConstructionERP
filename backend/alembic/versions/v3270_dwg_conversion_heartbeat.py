# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Add oe_dwg_takeoff_drawing.conversion_heartbeat_at.

The orphan detector needs to tell a dead conversion from a slow one. It used
to do that with elapsed time, which cannot separate the two: the xlsx parse
that follows the converter has no timeout and its cost tracks the size of the
drawing, so any cutoff derived from how long work *should* take will
eventually condemn a conversion that is running perfectly well. Measured on a
200,000 row export, that parse alone took 86 seconds, on top of a converter
already allowed 300.

This column carries a liveness signal instead: the background task refreshes
it on a fixed interval for as long as it is alive, so the cutoff becomes a
fact about how often we write rather than a guess about how long a customer's
drawing takes.

Nullable with no default, deliberately. NULL means no conversion has ever run
for this row, which is not the same as a stale one, and every row predating
this migration reads NULL. The detector treats NULL as "no evidence" rather
than as evidence of death, so this migration needs no backfill: there is
nothing truthful to backfill it with.

Revision ID: v3270_dwg_conversion_heartbeat
Revises: v3269_backfill_budget_currency
Create Date: 2026-08-01
"""

from __future__ import annotations

import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "v3270_dwg_conversion_heartbeat"
down_revision: Union[str, Sequence[str], None] = "v3269_backfill_budget_currency"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")

_TABLE = "oe_dwg_takeoff_drawing"
_COLUMN = "conversion_heartbeat_at"


def _columns(inspector: sa.engine.reflection.Inspector, table: str) -> set[str]:
    """Column names on ``table``, or an empty set when it does not exist."""
    if table not in inspector.get_table_names():
        return set()
    return {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    """Add the heartbeat column if it is not already there."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    existing = _columns(inspector, _TABLE)
    if not existing:
        # A partial install without the dwg_takeoff module. Not an error, and
        # not something that should stop an upgrade.
        logger.info("%s absent, nothing to add", _TABLE)
        return
    if _COLUMN in existing:
        logger.info("%s.%s already present", _TABLE, _COLUMN)
        return

    op.add_column(
        _TABLE,
        # No server_default. A default would stamp every existing row with a
        # timestamp, and the detector reads a present timestamp as "a
        # conversion was alive at that moment", which for these rows would be
        # a fabrication.
        sa.Column(_COLUMN, sa.DateTime(timezone=True), nullable=True),
    )
    logger.info("added %s.%s", _TABLE, _COLUMN)


def downgrade() -> None:
    """Drop the column.

    Unlike v3269, this side is genuinely reversible and so it is implemented
    rather than left empty. The distinction is what the column holds: v3269
    backfilled a user-meaningful value that cannot be told apart from one a
    user typed, so undoing it would have destroyed real data. What this column
    holds is an ephemeral liveness signal written by a background task, of no
    value once the task is gone. Dropping it loses nothing a user authored.
    """
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _COLUMN not in _columns(inspector, _TABLE):
        logger.info("%s.%s absent, nothing to drop", _TABLE, _COLUMN)
        return

    op.drop_column(_TABLE, _COLUMN)
