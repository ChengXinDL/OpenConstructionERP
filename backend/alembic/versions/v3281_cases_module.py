# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""cases: user-authored case scenarios and server-side case pins.

Until now the case scenarios were source files compiled into the frontend, so
writing one was a build step rather than something a user could do, and pinning
a case to a project lived in ``localStorage`` - per browser, not per account,
gone on another device or a cleared cache.

``oe_cases_user_case``
    One authored case. ``steps`` is a JSON array rather than a child table:
    the steps are always read and rewritten as a whole, so a child table would
    buy a relationship every caller has to eager-load and an ordinal column to
    keep in sync, and buy nothing back. The shape is validated by the Pydantic
    layer before it is stored.

    ``is_shared`` is the whole visibility model. There is no tenancy in the
    platform - one deployment is one company - so a shared case is readable by
    every signed-in user and a private one only by its owner. Editing stays
    with the owner either way.

``oe_cases_pin``
    One ``user x project x case`` pin. ``case_id`` carries either a shipped
    playbook slug or a case UUID, told apart by ``case_source``, so the two id
    spaces cannot collide. It is deliberately not a foreign key for the same
    reason, which is why the service deletes a case's pins by hand rather than
    leaving it to a cascade.

Nothing is backfilled. The pins that exist today are in browsers this
migration cannot reach, so there is no source to read them from; users
re-pin, and a wrong guess would be worse than an honest empty table.

Idempotent: every step is guarded by the inspector, so a fresh install built by
``Base.metadata.create_all`` is a no-op here.

Revision ID: v3281_cases_module
Revises: v3280_contract_templates
Create Date: 2026-08-05
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "v3281_cases_module"
down_revision: Union[str, Sequence[str], None] = "v3280_contract_templates"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_CASE = "oe_cases_user_case"
_PIN = "oe_cases_pin"

_IX_CASE_OWNER = "ix_cases_user_case_owner"
_IX_CASE_SHARED_CATEGORY = "ix_cases_user_case_shared_category"
_IX_PIN_USER_PROJECT = "ix_cases_pin_user_project"

# ``app.core.pg_optimizations`` hangs these off any table carrying a
# ``project_id`` when the schema is built by ``create_all``, and it does not run
# on the alembic path. Declaring them here is what stops an upgraded deployment
# getting a measurably different table from a fresh install. The composite index
# above does not cover them: its leftmost column is ``user_id``, so a lookup by
# project alone cannot use it.
_IX_PIN_PROJECT = "ix_oe_cases_pin_project_id"
_IX_PIN_PROJECT_CREATED = "ix_oe_cases_pin_project_id_created_at"


def _table_exists(table: str) -> bool:
    """Whether ``table`` is present in the database being migrated."""
    return table in sa.inspect(op.get_bind()).get_table_names()


def _indexes(table: str) -> set[str]:
    """Index names on ``table`` (empty when the table does not exist)."""
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {idx["name"] for idx in inspector.get_indexes(table) if idx.get("name")}


def upgrade() -> None:
    if not _table_exists(_CASE):
        op.create_table(
            _CASE,
            # String(36), not a native UUID type. The ORM's GUID type stores a
            # 36-character string, and a native uuid column here would produce
            # a schema the application reads with the wrong type on one of the
            # two install routes.
            sa.Column("id", sa.String(36), primary_key=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("owner_id", sa.String(36), nullable=False),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("long_description", sa.Text(), server_default="", nullable=False),
            sa.Column("category", sa.String(32), nullable=False),
            sa.Column("company_types", sa.JSON(), server_default="[]", nullable=False),
            sa.Column("roles", sa.JSON(), server_default="[]", nullable=False),
            sa.Column("stage", sa.String(64), server_default="", nullable=False),
            sa.Column("est_minutes", sa.Integer(), server_default="10", nullable=False),
            sa.Column("icon", sa.String(64), server_default="", nullable=False),
            sa.Column("steps", sa.JSON(), server_default="[]", nullable=False),
            sa.Column("source_playbook_id", sa.String(128), server_default="", nullable=False),
            sa.Column("is_shared", sa.Boolean(), server_default="0", nullable=False),
            sa.PrimaryKeyConstraint("id", name="pk_oe_cases_user_case"),
            sa.ForeignKeyConstraint(
                ["owner_id"],
                ["oe_users_user.id"],
                name="fk_oe_cases_user_case_owner_id_oe_users_user",
                ondelete="CASCADE",
            ),
        )

    case_indexes = _indexes(_CASE)
    if _IX_CASE_OWNER not in case_indexes:
        op.create_index(_IX_CASE_OWNER, _CASE, ["owner_id"])
    if _IX_CASE_SHARED_CATEGORY not in case_indexes:
        op.create_index(_IX_CASE_SHARED_CATEGORY, _CASE, ["is_shared", "category"])

    if not _table_exists(_PIN):
        op.create_table(
            _PIN,
            sa.Column("id", sa.String(36), primary_key=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("user_id", sa.String(36), nullable=False),
            sa.Column("project_id", sa.String(36), nullable=False),
            sa.Column("case_source", sa.String(16), nullable=False),
            sa.Column("case_id", sa.String(128), nullable=False),
            sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
            sa.Column("note", sa.Text(), server_default="", nullable=False),
            sa.PrimaryKeyConstraint("id", name="pk_oe_cases_pin"),
            sa.ForeignKeyConstraint(
                ["user_id"],
                ["oe_users_user.id"],
                name="fk_oe_cases_pin_user_id_oe_users_user",
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["project_id"],
                ["oe_projects_project.id"],
                name="fk_oe_cases_pin_project_id_oe_projects_project",
                ondelete="CASCADE",
            ),
            # The pin is per user, so the same case pinned by two people on one
            # project is two rows, not a conflict.
            sa.UniqueConstraint(
                "user_id",
                "project_id",
                "case_source",
                "case_id",
                name="uq_cases_pin_user_project_case",
            ),
        )

    pin_indexes = _indexes(_PIN)
    if _IX_PIN_USER_PROJECT not in pin_indexes:
        op.create_index(_IX_PIN_USER_PROJECT, _PIN, ["user_id", "project_id"])
    if _IX_PIN_PROJECT not in pin_indexes:
        op.create_index(_IX_PIN_PROJECT, _PIN, ["project_id"])
    if _IX_PIN_PROJECT_CREATED not in pin_indexes:
        op.create_index(_IX_PIN_PROJECT_CREATED, _PIN, ["project_id", "created_at"])


def downgrade() -> None:
    # Going down loses every authored case. There is nowhere else to keep one:
    # unlike the shipped playbooks, an authored case exists only in this table.
    if _table_exists(_PIN):
        op.drop_table(_PIN)
    if _table_exists(_CASE):
        op.drop_table(_CASE)
