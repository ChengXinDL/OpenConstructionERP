# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""einvoice_clearance: government clearance state for electronic invoices.

An invoice leaves this product as a PDF, and in a growing list of countries a
PDF is not an invoice. The tax authority sees the document before it is issued
in Mexico, Brazil, Italy, Poland, Romania, Saudi Arabia and India, after it is
issued in Spain and Hungary, and in the clearance countries the invoice is not
legally valid without the identifier the authority hands back. Nothing in the
schema had anywhere to put that identifier: ``oe_finance_invoice`` has no
authority status, no government UUID or stamp, and no submission or acceptance
timestamp.

``oe_einvoice_clearance_profile``
    How one legal entity is registered in one country. ``company_key`` is free
    text rather than a foreign key because the platform has no company table -
    one deployment is one company - while a group invoicing from two legal
    entities in the same country needs two registrations.

``oe_einvoice_clearance_document``
    One invoice on its way through one country's platform: the exact payload,
    its hash, the status, the identifier that came back and the authority's own
    rejection code. ``invoice_id`` and ``project_id`` are plain ids and not
    foreign keys, matching ``oe_finance_invoice`` itself, which carries
    ``project_id`` and ``source_claim_id`` the same way. It is also the right
    answer here for a second reason: a cleared document is a fiscal record whose
    counterpart is held by a tax authority, and deleting our copy of an invoice
    must not delete the record of what that authority issued.

``oe_einvoice_clearance_event``
    The append-only trail. When an authority rejects at 02:00 and accepts the
    corrected document at 09:00, the rejection is the part somebody needs six
    months later, and a status column has already forgotten it.

Nothing is backfilled. Every invoice that exists today was issued without going
through any of this, and inventing a clearance state for it would put rows in
the ledger claiming an authority saw something it never did.

Both intra-module foreign keys carry explicit names. Under the metadata naming
convention the generated names would run past the 63-byte PostgreSQL limit and
be truncated with a hash, leaving the ``create_all`` schema and this migration
disagreeing about a constraint name for no reason.

The two ``project_id`` composite indexes are declared by hand. An event listener
adds them on the ``create_all`` path only, so a revision that omitted them would
build a measurably different table from a fresh install.

Idempotent: every step is guarded by the inspector, so a fresh install built by
``Base.metadata.create_all`` is a no-op here.

Revision ID: v3282_einvoicing
Revises: v3281_cases_module
Create Date: 2026-08-05
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "v3282_einvoicing"
down_revision: Union[str, Sequence[str], None] = "v3281_cases_module"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_PROFILE = "oe_einvoice_clearance_profile"
_DOCUMENT = "oe_einvoice_clearance_document"
_EVENT = "oe_einvoice_clearance_event"

# Indexes declared on the models.
_IX_PROFILE_COUNTRY = "ix_einvoice_clearance_profile_country"
_IX_DOC_INVOICE = "ix_einvoice_clearance_document_invoice"
_IX_DOC_COUNTRY_STATUS = "ix_einvoice_clearance_document_country_status"
_IX_DOC_PAYLOAD_HASH = "ix_einvoice_clearance_document_payload_hash"
_IX_EVENT_DOC_SEQ = "ix_einvoice_clearance_event_document_seq"

# Indexes ``create_all`` produces from ``index=True``, named by the metadata
# convention ``ix_%(column_0_label)s``.
_IX_DOC_PROJECT = "ix_oe_einvoice_clearance_document_project_id"
_IX_DOC_PROFILE = "ix_oe_einvoice_clearance_document_profile_id"
_IX_DOC_STATUS = "ix_oe_einvoice_clearance_document_status"

# Indexes ``app.core.pg_optimizations`` hangs off any table carrying a
# ``project_id`` when the schema is built by ``create_all``. That listener does
# not run on the alembic path, so they are declared here.
_IX_DOC_PROJECT_CREATED = "ix_oe_einvoice_clearance_document_project_id_created_at"
_IX_DOC_PROJECT_STATUS = "ix_oe_einvoice_clearance_document_project_id_status"


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
    if not _table_exists(_PROFILE):
        op.create_table(
            _PROFILE,
            # String(36), not a native UUID type. The ORM's GUID type stores a
            # 36-character string, and a native uuid column here would produce a
            # schema the application reads with the wrong type on one of the two
            # install routes.
            sa.Column("id", sa.String(36), primary_key=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("company_key", sa.String(120), nullable=False),
            sa.Column("country", sa.String(2), nullable=False),
            sa.Column("regime", sa.String(16), nullable=False),
            sa.Column("platform", sa.String(64), server_default="", nullable=False),
            sa.Column("tax_registration_id", sa.String(64), server_default="", nullable=False),
            sa.Column("network_participant_id", sa.String(120), server_default="", nullable=False),
            sa.Column("certificate_reference", sa.String(255), server_default="", nullable=False),
            sa.Column("adapter_key", sa.String(64), server_default="", nullable=False),
            # Sandbox by default: a half-configured registration must not be
            # able to mint records that look like live fiscal identifiers.
            sa.Column("sandbox", sa.Boolean(), server_default="1", nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default="1", nullable=False),
            sa.Column("settings", sa.JSON(), server_default="{}", nullable=False),
            sa.Column("notes", sa.Text(), server_default="", nullable=False),
            sa.PrimaryKeyConstraint("id", name="pk_oe_einvoice_clearance_profile"),
            sa.UniqueConstraint(
                "company_key",
                "country",
                name="uq_einvoice_clearance_profile_company_country",
            ),
        )

    profile_indexes = _indexes(_PROFILE)
    if _IX_PROFILE_COUNTRY not in profile_indexes:
        op.create_index(_IX_PROFILE_COUNTRY, _PROFILE, ["country", "is_active"])

    if not _table_exists(_DOCUMENT):
        op.create_table(
            _DOCUMENT,
            sa.Column("id", sa.String(36), primary_key=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("project_id", sa.String(36), nullable=False),
            sa.Column("invoice_id", sa.String(36), nullable=True),
            sa.Column("profile_id", sa.String(36), nullable=False),
            sa.Column("country", sa.String(2), nullable=False),
            sa.Column("regime", sa.String(16), nullable=False),
            sa.Column("document_format", sa.String(64), server_default="", nullable=False),
            sa.Column("invoice_number", sa.String(64), server_default="", nullable=False),
            sa.Column("invoice_date", sa.String(40), server_default="", nullable=False),
            # Currency is explicit per row. An amount with an implied currency is
            # a bug in a module whose entire subject is that countries differ.
            sa.Column("currency_code", sa.String(3), server_default="", nullable=False),
            # NUMERIC, which is what MoneyType compiles to on PostgreSQL. Money
            # is never a float here: a binary float cannot hold 0.10 and a tax
            # authority's arithmetic is exact.
            sa.Column("total_amount", sa.Numeric(18, 2), server_default="0", nullable=False),
            sa.Column("payload", sa.Text(), server_default="", nullable=False),
            sa.Column("payload_hash", sa.String(64), server_default="", nullable=False),
            sa.Column(
                "payload_media_type",
                sa.String(80),
                server_default="application/xml",
                nullable=False,
            ),
            sa.Column("payload_size", sa.Integer(), server_default="0", nullable=False),
            sa.Column("country_fields", sa.JSON(), server_default="{}", nullable=False),
            sa.Column("status", sa.String(24), server_default="draft", nullable=False),
            sa.Column("authority_identifier", sa.String(255), server_default="", nullable=False),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("cleared_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
            # The authority's own code, kept verbatim. This is the string an
            # accountant is asked about by name.
            sa.Column("rejection_code", sa.String(64), server_default="", nullable=False),
            sa.Column("rejection_message", sa.Text(), server_default="", nullable=False),
            sa.Column("retry_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("cancellation_reason", sa.Text(), server_default="", nullable=False),
            sa.Column("adapter_key", sa.String(64), server_default="", nullable=False),
            sa.PrimaryKeyConstraint("id", name="pk_oe_einvoice_clearance_document"),
            sa.ForeignKeyConstraint(
                ["profile_id"],
                [f"{_PROFILE}.id"],
                name="fk_einvoice_clearance_document_profile",
                ondelete="RESTRICT",
            ),
        )

    document_indexes = _indexes(_DOCUMENT)
    if _IX_DOC_PROJECT not in document_indexes:
        op.create_index(_IX_DOC_PROJECT, _DOCUMENT, ["project_id"])
    if _IX_DOC_PROFILE not in document_indexes:
        op.create_index(_IX_DOC_PROFILE, _DOCUMENT, ["profile_id"])
    if _IX_DOC_STATUS not in document_indexes:
        op.create_index(_IX_DOC_STATUS, _DOCUMENT, ["status"])
    if _IX_DOC_INVOICE not in document_indexes:
        op.create_index(_IX_DOC_INVOICE, _DOCUMENT, ["invoice_id"])
    if _IX_DOC_COUNTRY_STATUS not in document_indexes:
        op.create_index(_IX_DOC_COUNTRY_STATUS, _DOCUMENT, ["country", "status"])
    if _IX_DOC_PAYLOAD_HASH not in document_indexes:
        # Deliberately not unique. Whether the same content may go again is a
        # business decision the rules make with the earlier document in hand,
        # and a unique constraint would turn that into an IntegrityError nobody
        # can explain to an accountant.
        op.create_index(_IX_DOC_PAYLOAD_HASH, _DOCUMENT, ["payload_hash"])
    if _IX_DOC_PROJECT_CREATED not in document_indexes:
        op.create_index(_IX_DOC_PROJECT_CREATED, _DOCUMENT, ["project_id", "created_at"])
    if _IX_DOC_PROJECT_STATUS not in document_indexes:
        op.create_index(_IX_DOC_PROJECT_STATUS, _DOCUMENT, ["project_id", "status"])

    if not _table_exists(_EVENT):
        op.create_table(
            _EVENT,
            sa.Column("id", sa.String(36), primary_key=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("document_id", sa.String(36), nullable=False),
            # Monotonic per document. ``created_at`` alone cannot order two
            # events written inside one transaction, and the order of a
            # submission and its rejection is exactly what a reader needs.
            sa.Column("sequence", sa.Integer(), server_default="1", nullable=False),
            sa.Column("event_type", sa.String(32), nullable=False),
            sa.Column("from_status", sa.String(24), server_default="", nullable=False),
            sa.Column("to_status", sa.String(24), server_default="", nullable=False),
            sa.Column("message", sa.Text(), server_default="", nullable=False),
            sa.Column("authority_code", sa.String(64), server_default="", nullable=False),
            sa.Column("raw_response", sa.JSON(), server_default="{}", nullable=False),
            sa.Column("actor_id", sa.String(36), nullable=True),
            sa.PrimaryKeyConstraint("id", name="pk_oe_einvoice_clearance_event"),
            sa.ForeignKeyConstraint(
                ["document_id"],
                [f"{_DOCUMENT}.id"],
                name="fk_einvoice_clearance_event_document",
                ondelete="CASCADE",
            ),
        )

    event_indexes = _indexes(_EVENT)
    if _IX_EVENT_DOC_SEQ not in event_indexes:
        op.create_index(_IX_EVENT_DOC_SEQ, _EVENT, ["document_id", "sequence"])


def downgrade() -> None:
    # Going down loses the record of every identifier a tax authority issued.
    # The authorities keep their own copies, so this is recoverable by hand and
    # only by hand; there is nowhere else in this schema the data lives.
    if _table_exists(_EVENT):
        op.drop_table(_EVENT)
    if _table_exists(_DOCUMENT):
        op.drop_table(_DOCUMENT)
    if _table_exists(_PROFILE):
        op.drop_table(_PROFILE)
