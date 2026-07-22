"""CDE per-project settings table.

Adds ``oe_cde_settings`` that stores what the CDE setup wizard captures for a
single project: the naming convention, the suitability-code set, the chosen
review preset, functional-role assignments, and the go-live gate (enabled flag
plus the minimum readiness level required before the whole team can be invited).

One row per project (unique FK to ``oe_projects_project``) with ``ON DELETE
CASCADE``. Existing projects acquire a default row lazily on first GET; the
migration intentionally does NOT backfill rows so the table stays empty until a
project actually configures its CDE.

Inspector-guarded so re-running on an already-migrated DB is a no-op (matches
the v281_match_project_settings pattern).

Revision ID: v3255_cde_settings
Revises: v3254_takeoff_measurement_color_nullable
Create Date: 2026-07-22
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "v3255_cde_settings"
down_revision: Union[str, Sequence[str], None] = "v3254_takeoff_measurement_color_nullable"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_TABLE = "oe_cde_settings"
_PROJECT_TABLE = "oe_projects_project"
_UQ = "uq_oe_cde_settings_project_id"
_IX = "ix_oe_cde_settings_project_id"


def _has_table(inspector: sa.engine.reflection.Inspector, name: str) -> bool:
    return name in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_table(inspector, _TABLE):
        return

    is_sqlite = bind.dialect.name == "sqlite"
    true_default = sa.text("1") if is_sqlite else sa.text("true")
    false_default = sa.text("0") if is_sqlite else sa.text("false")

    op.create_table(
        _TABLE,
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(length=36),
            sa.ForeignKey(
                f"{_PROJECT_TABLE}.id",
                ondelete="CASCADE",
                name="fk_oe_cde_settings_project_id_oe_projects_project",
            ),
            nullable=False,
        ),
        sa.Column("naming_convention", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("suitability_set", sa.String(length=50), nullable=False, server_default="iso19650"),
        sa.Column("review_preset_key", sa.String(length=100), nullable=True),
        sa.Column("role_assignments", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("go_live_gate_enabled", sa.Boolean(), nullable=False, server_default=true_default),
        sa.Column("min_readiness_level", sa.String(length=20), nullable=False, server_default="operational"),
        sa.Column("setup_completed", sa.Boolean(), nullable=False, server_default=false_default),
        sa.Column("setup_step", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("project_id", name=_UQ),
    )
    op.create_index(_IX, _TABLE, ["project_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, _TABLE):
        return

    existing_ix = {ix["name"] for ix in inspector.get_indexes(_TABLE)}
    if _IX in existing_ix:
        op.drop_index(_IX, table_name=_TABLE)
    op.drop_table(_TABLE)
