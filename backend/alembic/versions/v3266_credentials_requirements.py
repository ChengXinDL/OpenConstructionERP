# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""credentials: what the project requires, and who checked the ticket.

The register could say when a credential expires but not whether anyone needed
it. Answering "who may not work today" takes the other half of the question:
which credential types the project demands, of whom, and whether a gap stops
work or is merely noted.

Creates ``oe_credentials_requirement``:

* ``credential_type`` matched against the credential rows by code, not by a
  foreign key - the case that matters is the holder who has no matching row at
  all, and an FK can only point at credentials that exist
* ``applies_to``  - ``all``, or a discipline the holder is matched on
* ``is_blocking`` - whether a gap stops work or is a note for the file
* ``grace_days``  - how long a lapse is tolerated before it starts blocking
* a unique constraint over (project, type, audience, holder kind), so a rule
  added twice cannot double every gap it reports
* the same indexes a fresh ``create_all`` install would end up with, including
  the composite ``(project_id, created_at)`` one that ``app.core.pg_optimizations``
  adds on ``after_create``, so an upgraded database is not quietly missing an
  index a fresh one has

Adds to ``oe_credentials_credential``:

* ``verified_by`` / ``verified_at`` - both NULL means "claimed, never checked".
  Nullable with no default, so existing rows read as unverified, which is
  exactly what they are: nobody had checked them, because there was nowhere to
  record it.

Idempotent. The table is created only when the inspector says it is missing and
each column only when absent, so a fresh install that ran
``Base.metadata.create_all`` first is a no-op here.

Revision ID: v3266_credentials_requirements
Revises: v3265_rfq_comparable_quotes
Create Date: 2026-07-31
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

from app.database import GUID

revision: str = "v3266_credentials_requirements"
down_revision: Union[str, Sequence[str], None] = "v3265_rfq_comparable_quotes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_CREDENTIAL = "oe_credentials_credential"
_REQUIREMENT = "oe_credentials_requirement"

# (column, type) for the two verification columns on the credential table.
_VERIFICATION_COLUMNS: tuple[tuple[str, sa.types.TypeEngine], ...] = (
    ("verified_by", sa.String(36)),
    ("verified_at", sa.Date()),
)

_UNIQUE_SCOPE = "uq_credentials_requirement_scope"

# Named to match what ``app.core.pg_optimizations`` would generate for this
# table, so the two schema-building paths cannot produce it twice under two
# names. ``tests/modules/credentials/test_credentials_migration.py`` pins that.
_COMPOSITE_INDEX = "ix_oe_credentials_requirement_project_id_created_at"


def _table_exists(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _existing_columns(table: str) -> set[str]:
    """Column names already present on ``table`` (empty when it does not exist)."""
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    if not _table_exists(_REQUIREMENT):
        op.create_table(
            _REQUIREMENT,
            sa.Column("id", GUID(), primary_key=True),
            sa.Column(
                "project_id",
                GUID(),
                sa.ForeignKey(
                    "oe_projects_project.id",
                    ondelete="CASCADE",
                    name="fk_oe_credentials_requirement_project_id_oe_projects_project",
                ),
                nullable=False,
            ),
            sa.Column("credential_type", sa.String(64), nullable=False),
            sa.Column("applies_to", sa.String(64), nullable=False, server_default="all"),
            sa.Column("holder_kind", sa.String(16), nullable=False, server_default="person"),
            sa.Column(
                "is_blocking",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
            sa.Column("grace_days", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("metadata", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("created_by", sa.String(36), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.UniqueConstraint(
                "project_id",
                "credential_type",
                "applies_to",
                "holder_kind",
                name=_UNIQUE_SCOPE,
            ),
        )
        op.create_index(
            "ix_oe_credentials_requirement_project_id",
            _REQUIREMENT,
            ["project_id"],
        )
        op.create_index(
            "ix_oe_credentials_requirement_credential_type",
            _REQUIREMENT,
            ["credential_type"],
        )
        op.create_index(
            "ix_oe_credentials_requirement_is_active",
            _REQUIREMENT,
            ["is_active"],
        )
        # Mirrors the composite ``(project_id, created_at)`` index that
        # ``app.core.pg_optimizations`` attaches on ``after_create``. That hook
        # fires only for tables ``create_all`` actually creates, so whichever
        # path builds this table first is the one that decides whether the index
        # exists. Creating it here makes the two paths produce the same schema
        # either way; when ``create_all`` got there first this whole block is
        # skipped, index included.
        op.create_index(
            _COMPOSITE_INDEX,
            _REQUIREMENT,
            ["project_id", "created_at"],
        )

    present = _existing_columns(_CREDENTIAL)
    for column, type_ in _VERIFICATION_COLUMNS:
        if column not in present:
            op.add_column(_CREDENTIAL, sa.Column(column, type_, nullable=True))


def downgrade() -> None:
    present = _existing_columns(_CREDENTIAL)
    for column, _type in _VERIFICATION_COLUMNS:
        if column in present:
            op.drop_column(_CREDENTIAL, column)

    if _table_exists(_REQUIREMENT):
        # Indexes go with the table on PostgreSQL, but dropping them explicitly
        # keeps the downgrade readable and safe on backends that do not. Only
        # the ones actually present are dropped: which indexes a given database
        # carries depends on whether ``create_all`` or this revision built the
        # table, and a downgrade that raises on a missing index would strand the
        # deployment it was meant to rescue.
        present = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(_REQUIREMENT)}
        for index in (
            _COMPOSITE_INDEX,
            "ix_oe_credentials_requirement_is_active",
            "ix_oe_credentials_requirement_credential_type",
            "ix_oe_credentials_requirement_project_id",
        ):
            if index in present:
                op.drop_index(index, table_name=_REQUIREMENT)
        op.drop_table(_REQUIREMENT)
