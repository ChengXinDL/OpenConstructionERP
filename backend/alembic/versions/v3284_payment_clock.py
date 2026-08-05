# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""payment_clock: statutory payment regimes, applications, notices and breaches.

The platform already stores payment dates. It stores the ones somebody typed
into a workflow. In the United Kingdom, Ireland, Australia, New Zealand,
Singapore and Malaysia the dates around a payment application are imposed by
statute, and missing one has a defined legal consequence that no workflow field
records.

``oe_payment_clock_regime``
    One statutory regime: how the due date, the notice deadlines and the final
    date for payment are counted, what silence means, and how interest runs.
    Reference data, seeded on first read from
    ``app/modules/payment_clock/data.py`` and deliberately **not** from this
    migration: the statutory values belong somewhere they can be read and
    corrected, not frozen into the schema history as one reading of six
    statutes in 2026.

``oe_payment_clock_application``
    A payment application with the four statutory dates stored against it.
    Stored rather than derived on read, because a statutory date is evidence:
    it has to survive the catalogue being corrected next month, and an
    adjudicator asking what the deadline was wants the date the parties were
    working to. ``source_type`` + ``source_id`` point at the progress claim or
    subcontractor payment application this clock is about, and are not a
    foreign key because the target lives in either of two tables.

``oe_payment_clock_notice``
    A notice actually served: payment notice, pay-less notice, or the payee's
    default payment notice. Recorded whether or not it was valid - a notice
    served a day late is the most important fact about its application.

``oe_payment_clock_event``
    The breach register, written by the validation rules. One row per finding,
    carrying the deadline that was missed, how late it was, the amount at stake
    and the consequence in words.

Nothing is backfilled. The existing progress claims and subcontractor payment
applications carry no regime and no statutory dates, so there is nothing to
read them from, and guessing which jurisdiction a historic claim was served
under would put invented deadlines in front of a quantity surveyor. Clocks are
opened deliberately.

Idempotent: every step is guarded by the inspector, so a fresh install built by
``Base.metadata.create_all`` is a no-op here.

Revision ID: v3284_payment_clock
Revises: v3283_withholding
Create Date: 2026-08-05
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "v3284_payment_clock"
down_revision: Union[str, Sequence[str], None] = "v3283_withholding"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_REGIME = "oe_payment_clock_regime"
_APPLICATION = "oe_payment_clock_application"
_NOTICE = "oe_payment_clock_notice"
_EVENT = "oe_payment_clock_event"

_IX_REGIME_COUNTRY = "ix_payment_clock_regime_country"

_IX_APPLICATION_REGIME = "ix_oe_payment_clock_application_regime_id"
_IX_APPLICATION_FINAL_DATE = "ix_payment_clock_application_final_date"

_IX_NOTICE_APPLICATION_TYPE = "ix_payment_clock_notice_application_type"
_IX_EVENT_APPLICATION_TYPE = "ix_payment_clock_event_application_type"

# ``app.core.pg_optimizations`` hangs these off any table carrying a
# ``project_id`` when the schema is built by ``create_all``, and it does not run
# on the alembic path. Declaring them here is what stops an upgraded deployment
# getting a measurably different table from a fresh install.
_IX_APPLICATION_PROJECT = "ix_oe_payment_clock_application_project_id"
_IX_APPLICATION_PROJECT_CREATED = "ix_oe_payment_clock_application_project_id_created_at"
_IX_APPLICATION_PROJECT_STATUS = "ix_oe_payment_clock_application_project_id_status"

# The same generator indexes a plain foreign key column, which is what these two
# are on the child tables.
_IX_NOTICE_APPLICATION = "ix_oe_payment_clock_notice_application_id"
_IX_EVENT_APPLICATION = "ix_oe_payment_clock_event_application_id"


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
    if not _table_exists(_REGIME):
        op.create_table(
            _REGIME,
            # String(36), not a native UUID type. The ORM's GUID type stores a
            # 36-character string on every dialect, and a native uuid column
            # here would produce a schema the application reads with the wrong
            # type on one of the two install routes.
            sa.Column("id", sa.String(36), primary_key=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("code", sa.String(40), nullable=False),
            sa.Column("jurisdiction", sa.String(120), nullable=False),
            sa.Column("country_code", sa.String(2), server_default="", nullable=False),
            sa.Column("statute", sa.String(200), nullable=False),
            sa.Column("statute_reference", sa.String(300), server_default="", nullable=False),
            sa.Column("due_date_basis", sa.String(24), nullable=False),
            sa.Column("due_date_days", sa.Integer(), server_default="0", nullable=False),
            sa.Column("due_date_day_basis", sa.String(16), nullable=False),
            sa.Column("payment_notice_basis", sa.String(24), nullable=False),
            # Nullable throughout: a null means the statute is silent on this
            # step, which is a different statement from zero days. Malaysia
            # leaves the final date for payment to the contract; the EU Late
            # Payment Directive has no notice sequence at all.
            sa.Column("payment_notice_days", sa.Integer(), nullable=True),
            sa.Column("payment_notice_day_basis", sa.String(16), nullable=False),
            sa.Column("final_date_basis", sa.String(24), nullable=False),
            sa.Column("final_date_days", sa.Integer(), nullable=True),
            sa.Column("final_date_day_basis", sa.String(16), nullable=False),
            sa.Column("pay_less_days", sa.Integer(), nullable=True),
            sa.Column("pay_less_day_basis", sa.String(16), nullable=False),
            sa.Column("no_notice_effect", sa.String(48), nullable=False),
            sa.Column("interest_basis", sa.String(32), nullable=False),
            sa.Column("interest_reference_rate", sa.String(160), server_default="", nullable=False),
            # Numeric, never float. A rate that decides an interest calculation
            # is not something to hand to binary floating point.
            sa.Column("interest_margin_percent", sa.Numeric(6, 3), nullable=True),
            sa.Column("interest_fixed_percent", sa.Numeric(6, 3), nullable=True),
            sa.Column("interest_statute", sa.String(240), server_default="", nullable=False),
            sa.Column("notes", sa.Text(), server_default="", nullable=False),
            sa.PrimaryKeyConstraint("id", name="pk_oe_payment_clock_regime"),
            sa.UniqueConstraint("code", name="uq_payment_clock_regime_code"),
        )

    regime_indexes = _indexes(_REGIME)
    if _IX_REGIME_COUNTRY not in regime_indexes:
        op.create_index(_IX_REGIME_COUNTRY, _REGIME, ["country_code"])

    if not _table_exists(_APPLICATION):
        op.create_table(
            _APPLICATION,
            sa.Column("id", sa.String(36), primary_key=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("project_id", sa.String(36), nullable=False),
            sa.Column("regime_id", sa.String(36), nullable=False),
            sa.Column("source_type", sa.String(48), nullable=False),
            sa.Column("source_id", sa.String(36), nullable=True),
            sa.Column("reference", sa.String(64), server_default="", nullable=False),
            sa.Column("application_date", sa.Date(), nullable=False),
            sa.Column("period_start", sa.Date(), nullable=True),
            sa.Column("period_end", sa.Date(), nullable=True),
            sa.Column("applied_amount", sa.Numeric(18, 2), server_default="0", nullable=False),
            sa.Column("currency", sa.String(3), server_default="", nullable=False),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("payment_notice_deadline", sa.Date(), nullable=True),
            sa.Column("pay_less_deadline", sa.Date(), nullable=True),
            sa.Column("final_date", sa.Date(), nullable=True),
            sa.Column("dates_overridden", sa.Boolean(), server_default="0", nullable=False),
            sa.Column("status", sa.String(24), server_default="open", nullable=False),
            sa.Column("paid_at", sa.Date(), nullable=True),
            sa.Column("paid_amount", sa.Numeric(18, 2), nullable=True),
            sa.Column("created_by", sa.String(36), nullable=True),
            sa.Column("notes", sa.Text(), server_default="", nullable=False),
            sa.PrimaryKeyConstraint("id", name="pk_oe_payment_clock_application"),
            sa.ForeignKeyConstraint(
                ["project_id"],
                ["oe_projects_project.id"],
                name="fk_oe_payment_clock_application_project_id_oe_projects_project",
                ondelete="CASCADE",
            ),
            # RESTRICT, not CASCADE: a regime is reference data, and deleting
            # one out from under a live application would take with it the
            # record of which statute its dates were computed under. The name
            # is short because the convention name is 65 characters against
            # PostgreSQL's limit of 63 - see the note in ``models.py``.
            sa.ForeignKeyConstraint(
                ["regime_id"],
                ["oe_payment_clock_regime.id"],
                name="fk_payment_clock_application_regime",
                ondelete="RESTRICT",
            ),
            # One clock per source row. A ``manual`` row carries a null
            # ``source_id``, and PostgreSQL treats nulls as distinct, so any
            # number of them coexist while a given progress claim can only ever
            # be clocked once.
            sa.UniqueConstraint("source_type", "source_id", name="uq_payment_clock_application_source"),
        )

    application_indexes = _indexes(_APPLICATION)
    if _IX_APPLICATION_PROJECT not in application_indexes:
        op.create_index(_IX_APPLICATION_PROJECT, _APPLICATION, ["project_id"])
    if _IX_APPLICATION_REGIME not in application_indexes:
        op.create_index(_IX_APPLICATION_REGIME, _APPLICATION, ["regime_id"])
    if _IX_APPLICATION_PROJECT_CREATED not in application_indexes:
        op.create_index(_IX_APPLICATION_PROJECT_CREATED, _APPLICATION, ["project_id", "created_at"])
    if _IX_APPLICATION_PROJECT_STATUS not in application_indexes:
        op.create_index(_IX_APPLICATION_PROJECT_STATUS, _APPLICATION, ["project_id", "status"])
    # The register sweeps for applications whose final date has passed, across
    # projects. Without this that sweep is a sequential scan of every clock ever
    # opened.
    if _IX_APPLICATION_FINAL_DATE not in application_indexes:
        op.create_index(_IX_APPLICATION_FINAL_DATE, _APPLICATION, ["final_date"])

    if not _table_exists(_NOTICE):
        op.create_table(
            _NOTICE,
            sa.Column("id", sa.String(36), primary_key=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("application_id", sa.String(36), nullable=False),
            sa.Column("notice_type", sa.String(32), nullable=False),
            sa.Column("issued_at", sa.Date(), nullable=False),
            sa.Column("notified_amount", sa.Numeric(18, 2), nullable=True),
            sa.Column("currency", sa.String(3), server_default="", nullable=False),
            # Not nullable, and a rule checks it is not empty either. A pay-less
            # notice that does not say how the withheld sum was arrived at is
            # not a valid pay-less notice.
            sa.Column("basis_of_calculation", sa.Text(), server_default="", nullable=False),
            sa.Column("served_by", sa.String(200), server_default="", nullable=False),
            sa.Column("served_to", sa.String(200), server_default="", nullable=False),
            sa.Column("reference", sa.String(64), server_default="", nullable=False),
            sa.Column("created_by", sa.String(36), nullable=True),
            sa.PrimaryKeyConstraint("id", name="pk_oe_payment_clock_notice"),
            sa.ForeignKeyConstraint(
                ["application_id"],
                ["oe_payment_clock_application.id"],
                name="fk_payment_clock_notice_application",
                ondelete="CASCADE",
            ),
        )

    notice_indexes = _indexes(_NOTICE)
    if _IX_NOTICE_APPLICATION not in notice_indexes:
        op.create_index(_IX_NOTICE_APPLICATION, _NOTICE, ["application_id"])
    if _IX_NOTICE_APPLICATION_TYPE not in notice_indexes:
        op.create_index(_IX_NOTICE_APPLICATION_TYPE, _NOTICE, ["application_id", "notice_type"])

    if not _table_exists(_EVENT):
        op.create_table(
            _EVENT,
            sa.Column("id", sa.String(36), primary_key=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("application_id", sa.String(36), nullable=False),
            sa.Column("event_type", sa.String(48), nullable=False),
            sa.Column("severity", sa.String(16), nullable=False),
            sa.Column("rule_id", sa.String(64), server_default="", nullable=False),
            sa.Column("detected_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("deadline_date", sa.Date(), nullable=True),
            sa.Column("days_late", sa.Integer(), nullable=True),
            sa.Column("amount", sa.Numeric(18, 2), nullable=True),
            sa.Column("currency", sa.String(3), server_default="", nullable=False),
            sa.Column("consequence", sa.Text(), server_default="", nullable=False),
            # ``sa.JSON()``, which compiles to JSONB on PostgreSQL through the
            # application's own compiler hook. Nothing is ever queried inside
            # it: on a plain JSON column ``.contains()`` compiles to a string
            # LIKE rather than to JSONB containment, so the register reads and
            # writes this column whole. No GIN index for the same reason.
            sa.Column("detail", sa.JSON(), server_default="{}", nullable=False),
            sa.PrimaryKeyConstraint("id", name="pk_oe_payment_clock_event"),
            sa.ForeignKeyConstraint(
                ["application_id"],
                ["oe_payment_clock_application.id"],
                name="fk_payment_clock_event_application",
                ondelete="CASCADE",
            ),
        )

    event_indexes = _indexes(_EVENT)
    if _IX_EVENT_APPLICATION not in event_indexes:
        op.create_index(_IX_EVENT_APPLICATION, _EVENT, ["application_id"])
    if _IX_EVENT_APPLICATION_TYPE not in event_indexes:
        op.create_index(_IX_EVENT_APPLICATION_TYPE, _EVENT, ["application_id", "event_type"])


def downgrade() -> None:
    # Children first: both point at the application table, and the application
    # table points at the regime catalogue with RESTRICT.
    if _table_exists(_EVENT):
        op.drop_table(_EVENT)
    if _table_exists(_NOTICE):
        op.drop_table(_NOTICE)
    if _table_exists(_APPLICATION):
        op.drop_table(_APPLICATION)
    if _table_exists(_REGIME):
        op.drop_table(_REGIME)
