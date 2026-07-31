# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""FX rate-set history, quotes and per-project currency policy.

The FX module started as a single cached rate per currency pair, which can
answer "what is the rate" and nothing else. A construction project needs more:
it is estimated in one currency, procured in a second and reported in a third,
so a figure agreed last quarter has to be reproducible at the rates that
applied then, and a movement in a report has to be attributable to scope or to
the rate. These three tables are what makes that possible:

    oe_fx_rate_set   - one published set of rates: base currency, the date the
                       rates are effective for, who published them, what they
                       were read from, when they were captured, and whether the
                       set has been locked. Unique per (base, date, source), so
                       re-ingesting a feed replaces a set rather than
                       duplicating it.
    oe_fx_rate_quote - one currency's rate inside a set, as units of that
                       currency per one unit of the set's base. Numeric(20, 10)
                       because the inverse of a rate against a weak currency is
                       very small and six decimals loses about one percent of
                       it. Cascade-deleted with its set.
    oe_fx_policy     - one row per project: its three currencies, whether it
                       tracks live rates or is pinned to a set, and how stale a
                       rate may get before validation flags it.

The embedded-PostgreSQL runtime materialises these tables via ``create_all`` at
startup, so this migration is for external-PostgreSQL deployments that manage
schema with Alembic. Every step is inspector-guarded, so a re-run (or a DB the
runtime already auto-created) is a no-op. Additive: no existing table is
touched, and the legacy ``oe_fx_rate`` cache is left exactly as it was.
GUID columns are VARCHAR(36) (the app.database.GUID TypeDecorator impl).
PostgreSQL-only, no SQLite shims.

Revision ID: v3255_fx_rate_sets_and_policy
Revises: v3234_cost_search_trgm
Create Date: 2026-07-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "v3255_fx_rate_sets_and_policy"
down_revision = "v3234_cost_search_trgm"
branch_labels = None
depends_on = None

_SET_TABLE = "oe_fx_rate_set"
_QUOTE_TABLE = "oe_fx_rate_quote"
_POLICY_TABLE = "oe_fx_policy"


def _has_table(name: str) -> bool:
    insp = sa.inspect(op.get_bind())
    return name in insp.get_table_names()


def _has_index(table: str, name: str) -> bool:
    insp = sa.inspect(op.get_bind())
    if table not in insp.get_table_names():
        return False
    return any(index["name"] == name for index in insp.get_indexes(table))


def upgrade() -> None:
    if not _has_table(_SET_TABLE):
        op.create_table(
            _SET_TABLE,
            # GUID columns are stored as VARCHAR(36) (see app.database.GUID).
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("base_currency", sa.String(length=3), nullable=False, server_default="EUR"),
            # The date the rates apply to, not the date they were downloaded.
            sa.Column("rate_date", sa.Date(), nullable=False),
            sa.Column("source", sa.String(length=30), nullable=False, server_default="ecb"),
            sa.Column("source_ref", sa.String(length=500), nullable=False, server_default=""),
            # Capture time, deliberately distinct from rate_date: a set
            # published on Friday may only be fetched on Monday.
            sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("is_locked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("note", sa.String(length=500), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.UniqueConstraint(
                "base_currency",
                "rate_date",
                "source",
                name="uq_oe_fx_rate_set_base_date_source",
            ),
        )
    if not _has_index(_SET_TABLE, "ix_oe_fx_rate_set_base_date"):
        op.create_index("ix_oe_fx_rate_set_base_date", _SET_TABLE, ["base_currency", "rate_date"])

    if not _has_table(_QUOTE_TABLE):
        op.create_table(
            _QUOTE_TABLE,
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("rate_set_id", sa.String(length=36), nullable=False),
            sa.Column("currency", sa.String(length=3), nullable=False),
            # Units of currency per one base unit: a ratio, not money.
            sa.Column("rate", sa.Numeric(20, 10), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.ForeignKeyConstraint(
                ["rate_set_id"],
                [f"{_SET_TABLE}.id"],
                name="fk_oe_fx_rate_quote_rate_set",
                ondelete="CASCADE",
            ),
            sa.UniqueConstraint("rate_set_id", "currency", name="uq_oe_fx_rate_quote_set_currency"),
        )
    if not _has_index(_QUOTE_TABLE, "ix_oe_fx_rate_quote_rate_set_id"):
        op.create_index("ix_oe_fx_rate_quote_rate_set_id", _QUOTE_TABLE, ["rate_set_id"])

    if not _has_table(_POLICY_TABLE):
        op.create_table(
            _POLICY_TABLE,
            sa.Column("id", sa.String(length=36), primary_key=True),
            # Plain GUID rather than a cross-module FK, matching how the costs
            # module references projects.
            sa.Column("project_id", sa.String(length=36), nullable=False),
            sa.Column("estimating_currency", sa.String(length=3), nullable=False, server_default="EUR"),
            sa.Column("procurement_currency", sa.String(length=3), nullable=False, server_default="EUR"),
            sa.Column("reporting_currency", sa.String(length=3), nullable=False, server_default="EUR"),
            sa.Column("rate_mode", sa.String(length=10), nullable=False, server_default="live"),
            sa.Column("pinned_rate_set_id", sa.String(length=36), nullable=True),
            sa.Column("max_rate_age_days", sa.Integer(), nullable=False, server_default="30"),
            sa.Column("note", sa.String(length=500), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.ForeignKeyConstraint(
                ["pinned_rate_set_id"],
                [f"{_SET_TABLE}.id"],
                name="fk_oe_fx_policy_pinned_rate_set",
                ondelete="SET NULL",
            ),
            sa.UniqueConstraint("project_id", name="uq_oe_fx_policy_project"),
        )
    if not _has_index(_POLICY_TABLE, "ix_oe_fx_policy_pinned_rate_set_id"):
        op.create_index("ix_oe_fx_policy_pinned_rate_set_id", _POLICY_TABLE, ["pinned_rate_set_id"])


def downgrade() -> None:
    # Drop in dependency order: both the policy and the quotes reference the
    # rate set, so the set goes last. Indexes go with their tables.
    if _has_table(_POLICY_TABLE):
        op.drop_table(_POLICY_TABLE)
    if _has_table(_QUOTE_TABLE):
        op.drop_table(_QUOTE_TABLE)
    if _has_table(_SET_TABLE):
        op.drop_table(_SET_TABLE)
