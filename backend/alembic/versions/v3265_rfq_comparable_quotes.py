# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""RFQ scope lines, quote detail, adjustments and the award record.

The RFQ register stored an enquiry and a single headline amount per quote,
which is enough to list offers and not enough to compare them. Four tables and
two sets of columns turn it into a register a buyer can defend an award from:

    oe_rfq_line           - the scope suppliers are asked to price, one row per
                            item, so a quote covering part of it is visible as
                            such instead of reading as the cheapest offer.
    oe_rfq_bid_line       - one supplier's price for one scope line, with its
                            own unit and, where that unit differs from the
                            RFQ's, the factor that reconciles them.
    oe_rfq_bid_adjustment - an inclusion or an exclusion that moves a quote's
                            comparable total: freight one supplier priced and
                            the next left out, taxes, a discount, or a buyer
                            allowance covering scope nobody quoted.
    oe_rfq_award          - who won, at what normalised amount, against which
                            ranked table, and whether that was the quote the
                            comparison put first.

The columns added to ``oe_rfq_bid`` carry a quote's standing (received, late,
withdrawn, disqualified, and when a late quote was admitted and by whom) and the
exchange rate it was compared at. The rate is stored on the quote rather than
looked up later so the ranking stays reproducible after the market moves; the
FX register remains the source of published rates.

The columns added to ``oe_rfq_rfq`` carry the basis the award will be taken on:
the ranking method, its technical weight, and whether a quote for part of the
scope may be ranked at all.

Money is ``NUMERIC(18, 2)`` (the ``MoneyType`` column type), quantities
``NUMERIC(18, 4)``, the exchange rate ``NUMERIC(18, 8)`` and a unit conversion
factor ``NUMERIC(18, 6)``. ``oe_rfq_bid.bid_amount`` is deliberately left as it
is: existing rows hold Decimal strings there and rewriting them is a different
change from this one.

Every NOT NULL column carries a ``server_default`` matching the Python-side
default on the ORM model, so an installation that adds these columns to a table
with rows in it keeps writing.

Idempotent throughout: tables are created only when the inspector says they are
missing and columns only when the table does not already have them, so a
database the runtime already materialised with ``create_all`` is a no-op here.
GUID columns are VARCHAR(36), matching the ``app.database.GUID`` decorator.
PostgreSQL-only.

Revision ID: v3265_rfq_comparable_quotes
Revises: v3263_cost_match_runs
Create Date: 2026-07-31
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "v3265_rfq_comparable_quotes"
down_revision: Union[str, Sequence[str], None] = "v3264_full_evm_baseline_register"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_RFQ = "oe_rfq_rfq"
_BID = "oe_rfq_bid"
_LINE = "oe_rfq_line"
_BID_LINE = "oe_rfq_bid_line"
_ADJUSTMENT = "oe_rfq_bid_adjustment"
_AWARD = "oe_rfq_award"

# Creation order. The downgrade walks it in reverse so a child table is always
# dropped before the parent it points at.
_TABLES: tuple[str, ...] = (_LINE, _BID_LINE, _ADJUSTMENT, _AWARD)

_MONEY = sa.Numeric(18, 2)
_QUANTITY = sa.Numeric(18, 4)
_RATE = sa.Numeric(18, 8)
_FACTOR = sa.Numeric(18, 6)

# Columns added to the two tables that already exist. Built by a factory
# rather than held as module-level objects: a Column binds to the table it is
# added to, so one instance cannot serve two calls.


def _rfq_columns() -> list[sa.Column]:
    """The award-basis columns added to the RFQ table."""
    return [
        sa.Column("evaluation_method", sa.String(length=30), nullable=False, server_default="lowest_price"),
        sa.Column("technical_weight", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("require_full_scope", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    ]


def _bid_columns() -> list[sa.Column]:
    """The standing and conversion columns added to the quote table."""
    return [
        sa.Column("status", sa.String(length=30), nullable=False, server_default="received"),
        sa.Column("is_late", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("admitted_by", sa.String(36), nullable=True),
        sa.Column("admitted_at", sa.String(length=40), nullable=True),
        sa.Column("admission_reason", sa.Text(), nullable=True),
        sa.Column("late_reason", sa.Text(), nullable=True),
        sa.Column("disqualified_reason", sa.Text(), nullable=True),
        sa.Column("withdrawn_at", sa.String(length=40), nullable=True),
        sa.Column("withdrawn_reason", sa.Text(), nullable=True),
        sa.Column("exchange_rate", _RATE, nullable=True),
        sa.Column("exchange_rate_date", sa.String(length=20), nullable=True),
        sa.Column("exchange_rate_source", sa.String(length=60), nullable=True),
    ]


def _existing_tables() -> set[str]:
    """Table names already present in the target database."""
    inspector = sa.inspect(op.get_bind())
    return set(inspector.get_table_names())


def _existing_columns(table: str) -> set[str]:
    """Column names already present on one table."""
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns(table)}


def _add_columns(table: str, columns: list[sa.Column]) -> None:
    """Add the columns the table does not already have."""
    if table not in _existing_tables():
        return
    present = _existing_columns(table)
    for column in columns:
        if column.name not in present:
            op.add_column(table, column)


def _drop_columns(table: str, names: list[str]) -> None:
    """Drop the columns the table still has."""
    if table not in _existing_tables():
        return
    present = _existing_columns(table)
    for name in names:
        if name in present:
            op.drop_column(table, name)


def _timestamps() -> list[sa.Column]:
    """The two columns every platform table carries."""
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def _create_line() -> None:
    op.create_table(
        _LINE,
        sa.Column("id", sa.String(36), primary_key=True, nullable=False),
        *_timestamps(),
        sa.Column("rfq_id", sa.String(36), nullable=False),
        sa.Column("line_no", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("unit", sa.String(length=20), nullable=False),
        sa.Column("quantity", _QUANTITY, nullable=False, server_default="0"),
        sa.Column("is_optional", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("cost_line_id", sa.String(36), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default="{}"),
        sa.ForeignKeyConstraint(
            ["rfq_id"],
            [f"{_RFQ}.id"],
            name="fk_oe_rfq_line_rfq_id_oe_rfq_rfq",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("rfq_id", "line_no", name="uq_oe_rfq_line_rfq_no"),
    )
    op.create_index("ix_oe_rfq_line_rfq_id", _LINE, ["rfq_id"])


def _create_bid_line() -> None:
    op.create_table(
        _BID_LINE,
        sa.Column("id", sa.String(36), primary_key=True, nullable=False),
        *_timestamps(),
        sa.Column("bid_id", sa.String(36), nullable=False),
        # Nullable: a supplier may price something the buyer did not ask for,
        # and an extra that is silently dropped is how a headline total stops
        # agreeing with the detail behind it.
        sa.Column("rfq_line_id", sa.String(36), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("unit", sa.String(length=20), nullable=False, server_default=""),
        sa.Column("quantity", _QUANTITY, nullable=False, server_default="0"),
        sa.Column("unit_rate", _MONEY, nullable=False, server_default="0"),
        sa.Column("amount", _MONEY, nullable=False, server_default="0"),
        sa.Column("unit_conversion_factor", _FACTOR, nullable=True),
        sa.Column("is_excluded", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["bid_id"],
            [f"{_BID}.id"],
            name="fk_oe_rfq_bid_line_bid_id_oe_rfq_bid",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["rfq_line_id"],
            [f"{_LINE}.id"],
            name="fk_oe_rfq_bid_line_rfq_line_id_oe_rfq_line",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_oe_rfq_bid_line_bid_id", _BID_LINE, ["bid_id"])
    op.create_index("ix_oe_rfq_bid_line_rfq_line_id", _BID_LINE, ["rfq_line_id"])


def _create_adjustment() -> None:
    op.create_table(
        _ADJUSTMENT,
        sa.Column("id", sa.String(36), primary_key=True, nullable=False),
        *_timestamps(),
        sa.Column("bid_id", sa.String(36), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        # Signed: a discount lowers the comparable total.
        sa.Column("amount", _MONEY, nullable=False, server_default="0"),
        sa.Column("currency_code", sa.String(length=10), nullable=False, server_default="EUR"),
        sa.Column("included_in_bid", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="bidder"),
        sa.ForeignKeyConstraint(
            ["bid_id"],
            [f"{_BID}.id"],
            name="fk_oe_rfq_bid_adjustment_bid_id_oe_rfq_bid",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_oe_rfq_bid_adjustment_bid_id", _ADJUSTMENT, ["bid_id"])


def _create_award() -> None:
    op.create_table(
        _AWARD,
        sa.Column("id", sa.String(36), primary_key=True, nullable=False),
        *_timestamps(),
        sa.Column("rfq_id", sa.String(36), nullable=False),
        sa.Column("bid_id", sa.String(36), nullable=False),
        sa.Column("awarded_by", sa.String(36), nullable=True),
        sa.Column("awarded_at", sa.String(length=40), nullable=False),
        sa.Column("method", sa.String(length=30), nullable=False, server_default="lowest_price"),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("recommended_bid_id", sa.String(36), nullable=True),
        sa.Column("is_override", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("awarded_amount", _MONEY, nullable=False, server_default="0"),
        sa.Column("awarded_currency", sa.String(length=10), nullable=False, server_default="EUR"),
        # The ranked table as it stood when the decision was taken.
        sa.Column("basis", sa.JSON(), nullable=False, server_default="{}"),
        sa.ForeignKeyConstraint(
            ["rfq_id"],
            [f"{_RFQ}.id"],
            name="fk_oe_rfq_award_rfq_id_oe_rfq_rfq",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["bid_id"],
            [f"{_BID}.id"],
            name="fk_oe_rfq_award_bid_id_oe_rfq_bid",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("rfq_id", name="uq_oe_rfq_award_rfq"),
    )
    op.create_index("ix_oe_rfq_award_rfq_id", _AWARD, ["rfq_id"])
    op.create_index("ix_oe_rfq_award_bid_id", _AWARD, ["bid_id"])


_CREATORS = {
    _LINE: _create_line,
    _BID_LINE: _create_bid_line,
    _ADJUSTMENT: _create_adjustment,
    _AWARD: _create_award,
}


def upgrade() -> None:
    """Add the comparison columns and create the four register tables."""
    _add_columns(_RFQ, _rfq_columns())
    _add_columns(_BID, _bid_columns())

    existing = _existing_tables()
    for table in _TABLES:
        if table in existing:
            continue
        _CREATORS[table]()


def downgrade() -> None:
    """Drop the register tables and the columns this revision added.

    Children before parents, and the added columns last: a quote's standing and
    its exchange rate are read by nothing else, but dropping them while the
    award table still references the quote would leave the award pointing at a
    row the application can no longer interpret.
    """
    existing = _existing_tables()
    for table in reversed(_TABLES):
        if table in existing:
            op.drop_table(table)

    _drop_columns(_BID, [column.name for column in _bid_columns()])
    _drop_columns(_RFQ, [column.name for column in _rfq_columns()])
