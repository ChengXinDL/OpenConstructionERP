# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Credentials registry - professional credentials with validity windows.

Creates ``oe_credentials_credential``: a project-scoped register of the
professional credentials a delivery relies on (licences, certifications,
statutory memberships, professional indemnity, registrations, training) with a
validity window, a renewal-reminder threshold and an optional statutory
notification obligation. Status is derived from the window and stored so
``status`` list filters hit an index.

GUID columns are VARCHAR(36) (the app.database.GUID TypeDecorator impl);
``project_id`` carries a real FK to the project with cascade delete so
credentials die with their project, and ``holder_user_id`` a SET NULL FK to the
user (a credential may name a non-user professional). Code fields are plain
VARCHAR (never DB enums) so a regional pack can add a value without a migration.
``metadata`` is JSON defaulting to ``{}``; the timestamps are tz-aware.

The embedded-PostgreSQL runtime materialises this table via ``create_all`` at
startup, so this migration mainly serves external-PostgreSQL deployments that
manage schema with Alembic. Every step is inspector-guarded, so a re-run (or a
DB the runtime already auto-created) is a no-op. Additive: no existing table is
touched. Chained after v3252_approval_route_system_key to keep a single linear
head. PostgreSQL-only.

Revision ID: v3253_credentials
Revises: v3252_approval_route_system_key
Create Date: 2026-07-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "v3253_credentials"
down_revision = "v3252_approval_route_system_key"
branch_labels = None
depends_on = None

_CRED = "oe_credentials_credential"


def _has_table(name: str) -> bool:
    insp = sa.inspect(op.get_bind())
    return name in insp.get_table_names()


def _create_credential() -> None:
    if _has_table(_CRED):
        return
    op.create_table(
        _CRED,
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(length=36),
            sa.ForeignKey("oe_projects_project.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("holder_name", sa.String(length=255), nullable=False),
        sa.Column("holder_kind", sa.String(length=16), nullable=False, server_default="person"),
        sa.Column(
            "holder_user_id",
            sa.String(length=36),
            sa.ForeignKey("oe_users_user.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("credential_type", sa.String(length=64), nullable=False),
        sa.Column("discipline", sa.String(length=64), nullable=True),
        sa.Column("authority", sa.String(length=255), nullable=True),
        sa.Column("identifier", sa.String(length=120), nullable=True),
        sa.Column("jurisdiction", sa.String(length=64), nullable=True),
        sa.Column("issued_at", sa.Date(), nullable=True),
        sa.Column("valid_until", sa.Date(), nullable=True),
        sa.Column("notify_days_before", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("notification_obligation_days", sa.Integer(), nullable=True),
        sa.Column("notification_trigger", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_by", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_credentials_credential_project", _CRED, ["project_id"])
    op.create_index("ix_credentials_credential_type", _CRED, ["credential_type"])
    op.create_index("ix_credentials_credential_valid_until", _CRED, ["valid_until"])
    op.create_index("ix_credentials_credential_status", _CRED, ["status"])
    op.create_index("ix_credentials_credential_created_by", _CRED, ["created_by"])


def upgrade() -> None:
    """Create the credentials table (idempotent)."""
    _create_credential()


def downgrade() -> None:
    """Drop the credentials table (idempotent)."""
    if _has_table(_CRED):
        op.drop_table(_CRED)
