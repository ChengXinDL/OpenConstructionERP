"""Add ``review_route_id`` to ``oe_cde_settings``.

The CDE approval-presets library (three read-only, tenant-wide ISO 19650
review flows seeded by ``approval_routes/seed.py``) can now be "adopted" by a
project in one click via ``POST /v1/approval-routes/routes/{id}/clone`` - the
clone is a normal, editable, project-scoped route. ``review_route_id`` points
at that cloned route so the CDE settings page and setup wizard know which
route is actually wired up, distinct from ``review_preset_key`` (which stays
as a label recording which preset the project started from).

A soft cross-module reference (no FK), matching the existing
``DocumentRevision.document_id`` / ``current_revision_id`` pattern in this
same module - approval_routes owns its own table lifecycle independently.

Inspector-guarded so re-running on an already-migrated DB is a no-op.

Revision ID: v3256_cde_review_route
Revises: v3255_cde_settings
Create Date: 2026-07-23
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "v3256_cde_review_route"
down_revision: Union[str, Sequence[str], None] = "v3255_cde_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_TABLE = "oe_cde_settings"
_COLUMN = "review_route_id"


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
        sa.Column(_COLUMN, sa.String(length=36), nullable=True),
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
