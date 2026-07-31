# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""full_evm: performance measurement baselines, their curve, and measurements.

Creates the three tables behind the Earned Value Management register:

* ``oe_full_evm_baseline``        - the approved budget a project is measured against
* ``oe_full_evm_baseline_period`` - one point on the cumulative planned-value curve
* ``oe_full_evm_measure``         - one data date with the full derived metric set

Three design points are visible in the DDL and are deliberate.

Money is ``Numeric(18, 4)``, never a float and never text. Four decimals covers
every ISO 4217 minor-unit count, so a three-decimal currency is stored exactly
rather than pre-rounded by the column. The older ``oe_evm_forecast`` table in
this module stores amounts as ``String`` for compatibility with the finance
snapshot it reads; it is untouched here, and the two generations coexist on
purpose rather than being migrated under running alerting code.

Dimensionless indices (CPI, SPI, TCPI, the percentages) are **nullable**
``Numeric(12, 6)``, and NULL means the index is undefined - its denominator was
zero. That is the normal state of a project that has not spent anything yet.
A NOT NULL column defaulting to 0 would report an unstarted project as
maximally inefficient, so nullability here is the correctness property, not a
convenience.

There is no foreign key from the baseline to ``oe_projects_project``. The
module's own endpoints resolve project ownership per request, and a hard
constraint would make the register uninstallable on a deployment that has not
enabled the projects module. Periods and measurements DO cascade from their
baseline, because neither is meaningful without it.

Every NOT NULL column carries a ``server_default`` matching the Python-side
``default`` on the ORM model. Losing either half is how a fresh install ends up
with rows the application cannot write, so the two are kept in step.

Idempotent by table: each is created only when the inspector says it is
missing, so an installation that already ran ``Base.metadata.create_all`` is a
no-op here and one that never had the module is created from scratch.

Revision ID: v3264_full_evm_baseline_register
Revises: v3263_cost_match_runs
Create Date: 2026-07-31
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "v3264_full_evm_baseline_register"
down_revision: Union[str, Sequence[str], None] = "v3263_cost_match_runs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_BASELINE = "oe_full_evm_baseline"
_PERIOD = "oe_full_evm_baseline_period"
_MEASURE = "oe_full_evm_measure"

# Creation order. The downgrade walks it in reverse so a child table is always
# dropped before the parent it points at.
_TABLES: tuple[str, ...] = (_BASELINE, _PERIOD, _MEASURE)

# Money and ratio precisions, kept in one place so the three tables cannot
# drift apart from each other or from the ORM model.
_MONEY = sa.Numeric(18, 4)
_RATIO = sa.Numeric(12, 6)


def _existing_tables() -> set[str]:
    """Table names already present in the target database."""
    inspector = sa.inspect(op.get_bind())
    return set(inspector.get_table_names())


def _create_baseline() -> None:
    op.create_table(
        _BASELINE,
        sa.Column("id", sa.String(36), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="draft"),
        sa.Column("bac", _MONEY, nullable=False, server_default="0"),
        sa.Column("currency", sa.String(length=3), nullable=True),
        sa.Column("minor_units", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("finish_date", sa.Date(), nullable=True),
        sa.Column("approved_by", sa.String(36), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("validation_status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("validation_findings", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("validation_score", sa.Float(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default="{}"),
        sa.UniqueConstraint("project_id", "name", name="uq_full_evm_baseline_project_name"),
    )
    op.create_index("ix_oe_full_evm_baseline_project_id", _BASELINE, ["project_id"])
    op.create_index("ix_full_evm_baseline_project_status", _BASELINE, ["project_id", "status"])


def _create_period() -> None:
    op.create_table(
        _PERIOD,
        sa.Column("id", sa.String(36), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("baseline_id", sa.String(36), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("label", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("planned_value", _MONEY, nullable=False, server_default="0"),
        sa.Column("planned_quantity", _MONEY, nullable=True),
        sa.ForeignKeyConstraint(
            ["baseline_id"],
            [f"{_BASELINE}.id"],
            name="fk_oe_full_evm_baseline_period_baseline_id_oe_full_evm_baseline",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("baseline_id", "ordinal", name="uq_full_evm_period_baseline_ordinal"),
        sa.UniqueConstraint("baseline_id", "period_end", name="uq_full_evm_period_baseline_end"),
    )
    op.create_index("ix_oe_full_evm_baseline_period_baseline_id", _PERIOD, ["baseline_id"])
    op.create_index("ix_full_evm_period_baseline_end", _PERIOD, ["baseline_id", "period_end"])


def _create_measure() -> None:
    op.create_table(
        _MEASURE,
        sa.Column("id", sa.String(36), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("baseline_id", sa.String(36), nullable=False),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("data_date", sa.Date(), nullable=False),
        sa.Column("source", sa.String(length=24), nullable=False, server_default="manual"),
        sa.Column("currency", sa.String(length=3), nullable=True),
        # Observations.
        sa.Column("bac", _MONEY, nullable=False, server_default="0"),
        sa.Column("pv", _MONEY, nullable=False, server_default="0"),
        sa.Column("ev", _MONEY, nullable=False, server_default="0"),
        sa.Column("ac", _MONEY, nullable=False, server_default="0"),
        sa.Column("planned_quantity", _MONEY, nullable=True),
        sa.Column("actual_quantity", _MONEY, nullable=True),
        # Performance to date. sv and cv are always defined (subtraction);
        # spi and cpi are nullable because their denominator can be zero.
        sa.Column("sv", _MONEY, nullable=False, server_default="0"),
        sa.Column("cv", _MONEY, nullable=False, server_default="0"),
        sa.Column("spi", _RATIO, nullable=True),
        sa.Column("cpi", _RATIO, nullable=True),
        sa.Column("percent_complete", _RATIO, nullable=True),
        sa.Column("percent_spent", _RATIO, nullable=True),
        # Forecast. Both the requested and the effective EAC formula are kept:
        # they differ whenever the requested one had a zero divisor.
        sa.Column("eac_method", sa.String(length=16), nullable=False, server_default="auto"),
        sa.Column("eac_method_effective", sa.String(length=16), nullable=False, server_default="remaining"),
        sa.Column("eac", _MONEY, nullable=True),
        sa.Column("etc", _MONEY, nullable=True),
        sa.Column("vac", _MONEY, nullable=True),
        sa.Column("tcpi_bac", _RATIO, nullable=True),
        sa.Column("tcpi_eac", _RATIO, nullable=True),
        sa.Column("eac_variants", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("validation_status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("validation_findings", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("validation_score", sa.Float(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default="{}"),
        sa.ForeignKeyConstraint(
            ["baseline_id"],
            [f"{_BASELINE}.id"],
            name="fk_oe_full_evm_measure_baseline_id_oe_full_evm_baseline",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("baseline_id", "data_date", name="uq_full_evm_measure_baseline_date"),
    )
    op.create_index("ix_oe_full_evm_measure_baseline_id", _MEASURE, ["baseline_id"])
    op.create_index("ix_oe_full_evm_measure_project_id", _MEASURE, ["project_id"])
    op.create_index("ix_full_evm_measure_project_date", _MEASURE, ["project_id", "data_date"])


_CREATORS = {
    _BASELINE: _create_baseline,
    _PERIOD: _create_period,
    _MEASURE: _create_measure,
}


def upgrade() -> None:
    """Create the register tables that are not already present."""
    existing = _existing_tables()
    for table in _TABLES:
        if table in existing:
            continue
        _CREATORS[table]()


def downgrade() -> None:
    """Drop the register tables, children before parents."""
    existing = _existing_tables()
    for table in reversed(_TABLES):
        if table in existing:
            op.drop_table(table)
