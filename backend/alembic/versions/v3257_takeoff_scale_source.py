"""Add ``scale_source`` to ``oe_takeoff_measurement``.

A takeoff stores the scale ratio each measurement was captured at but not
where that ratio came from. When a sheet turns out to be mis-scaled - the one
error that multiplies through every quantity on it - there is no way to tell
which rows inherited the bad calibration and which were set from the drawing's
own scale note, so the whole document has to be re-checked by hand.

Deliberately nullable with no backfill. Rows created before this column read
NULL, and NULL means "not recorded", which is the honest answer; guessing a
source for historical rows would defeat the purpose of a provenance field.
Consumers render NULL as "Unknown" rather than as an empty cell.

Inspector-guarded so re-running on an already-migrated DB is a no-op.

Revision ID: v3257_takeoff_scale_source
Revises: v3256_cde_review_route
Create Date: 2026-07-26
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "v3257_takeoff_scale_source"
down_revision: Union[str, Sequence[str], None] = "v3256_cde_review_route"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_TABLE = "oe_takeoff_measurement"
_COLUMN = "scale_source"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _TABLE not in inspector.get_table_names():
        return

    existing_cols = {c["name"] for c in inspector.get_columns(_TABLE)}
    if _COLUMN in existing_cols:
        return

    op.add_column(
        _TABLE,
        sa.Column(_COLUMN, sa.String(length=24), nullable=True),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _TABLE not in inspector.get_table_names():
        return

    existing_cols = {c["name"] for c in inspector.get_columns(_TABLE)}
    if _COLUMN not in existing_cols:
        return

    op.drop_column(_TABLE, _COLUMN)
