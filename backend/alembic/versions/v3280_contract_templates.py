# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""contracts: authored, versioned clause templates.

Until now a contract clause template was a module constant. A user could read
the eleven standard forms we ship and could not create, amend or version one,
which makes them samples rather than a feature. This adds the two tables that
let a tenant author its own paper, and the two columns that let a contract say
which version of a template it was drawn from.

``oe_contracts_template``
    One row per *version*. Versions of one template share a ``code`` and are
    told apart by ``version``, so uniqueness is on the pair, not on the code.
    ``lineage_id`` ties the versions together and holds the id of version 1.
    ``status`` is draft / published / archived; publishing freezes a version
    and the next edit opens N+1 rather than mutating a version a contract may
    already name.

``oe_contracts_template_clause``
    The clauses one version holds, copied by value per version. Unique on
    (template_id, number) so one version cannot carry clause 14.3 twice.

``oe_contracts_contract`` gains ``template_code`` and ``template_version``.
They are both-or-neither by intent: a code without a version would mean the
contract was drawn from whatever is current, which is the single thing
versioning exists to prevent. Both are nullable because every contract that
already exists was drawn from nothing, and backfilling a guess would be worse
than an honest null.

The built-in catalogue is deliberately NOT seeded into these tables. It stays
in ``service.CONTRACT_CLAUSE_TEMPLATES`` and the union of built-in and authored
happens in one repository method. A data seed here would reach almost nobody:
the documented deploy path is ``create_all`` plus ``alembic stamp head`` and
never walks this chain.

Idempotent: every step is guarded by the inspector, so a fresh install built by
``Base.metadata.create_all`` is a no-op here.

Revision ID: v3280_contract_templates
Revises: v3273_backfill_cost_item_currency
Create Date: 2026-08-04
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "v3280_contract_templates"
down_revision: Union[str, Sequence[str], None] = "v3273_backfill_cost_item_currency"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_CONTRACT = "oe_contracts_contract"
_TEMPLATE = "oe_contracts_template"
_CLAUSE = "oe_contracts_template_clause"

_IX_TEMPLATE_CODE = "ix_oe_contracts_template_code"
_IX_TEMPLATE_LINEAGE = "ix_oe_contracts_template_lineage_id"
_IX_TEMPLATE_FAMILY = "ix_oe_contracts_template_family"
_IX_TEMPLATE_STATUS = "ix_oe_contracts_template_status"
_IX_CLAUSE_TEMPLATE = "ix_oe_contracts_template_clause_template_id"
_IX_CLAUSE_RISK = "ix_oe_contracts_template_clause_risk_level"
_IX_CONTRACT_TEMPLATE_CODE = "ix_oe_contracts_contract_template_code"


def _table_exists(table: str) -> bool:
    """Whether ``table`` is present in the database being migrated."""
    return table in sa.inspect(op.get_bind()).get_table_names()


def _columns(table: str) -> set[str]:
    """Column names on ``table`` (empty when the table does not exist)."""
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {col["name"] for col in inspector.get_columns(table)}


def _indexes(table: str) -> set[str]:
    """Index names on ``table`` (empty when the table does not exist)."""
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {idx["name"] for idx in inspector.get_indexes(table) if idx.get("name")}


def upgrade() -> None:
    if not _table_exists(_TEMPLATE):
        op.create_table(
            _TEMPLATE,
            # String(36), not a native UUID type. The ORM's GUID type stores a
            # 36-character string, and a native uuid column here would produce
            # a schema the application reads with the wrong type on one of the
            # two install routes.
            sa.Column("id", sa.String(36), primary_key=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("code", sa.String(80), nullable=False),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.Column("lineage_id", sa.String(36), nullable=False),
            sa.Column("name", sa.String(500), nullable=False),
            sa.Column("family", sa.String(40), nullable=False),
            sa.Column("description", sa.Text(), server_default="", nullable=False),
            sa.Column("retention_release_event", sa.String(50), nullable=False),
            sa.Column("status", sa.String(20), server_default="draft", nullable=False),
            sa.Column("published_at", sa.String(40), nullable=True),
            sa.Column("published_by", sa.String(36), nullable=True),
            sa.Column("derived_from_builtin", sa.String(80), nullable=True),
            sa.Column("created_by", sa.String(36), nullable=True),
            sa.Column("metadata", sa.JSON(), server_default="{}", nullable=False),
            sa.PrimaryKeyConstraint("id", name="pk_oe_contracts_template"),
            sa.UniqueConstraint("code", "version", name="uq_oe_contracts_template_code_version"),
        )

    template_indexes = _indexes(_TEMPLATE)
    if _IX_TEMPLATE_CODE not in template_indexes:
        op.create_index(_IX_TEMPLATE_CODE, _TEMPLATE, ["code"])
    if _IX_TEMPLATE_LINEAGE not in template_indexes:
        op.create_index(_IX_TEMPLATE_LINEAGE, _TEMPLATE, ["lineage_id"])
    if _IX_TEMPLATE_FAMILY not in template_indexes:
        op.create_index(_IX_TEMPLATE_FAMILY, _TEMPLATE, ["family"])
    if _IX_TEMPLATE_STATUS not in template_indexes:
        op.create_index(_IX_TEMPLATE_STATUS, _TEMPLATE, ["status"])

    if not _table_exists(_CLAUSE):
        op.create_table(
            _CLAUSE,
            sa.Column("id", sa.String(36), primary_key=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("template_id", sa.String(36), nullable=False),
            sa.Column("number", sa.String(40), nullable=False),
            sa.Column("title", sa.String(500), nullable=False),
            sa.Column("body", sa.Text(), server_default="", nullable=False),
            sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
            sa.Column("risk_level", sa.String(20), server_default="none", nullable=False),
            sa.Column("risk_note", sa.Text(), server_default="", nullable=False),
            sa.Column("is_optional", sa.Boolean(), server_default="0", nullable=False),
            sa.PrimaryKeyConstraint("id", name="pk_oe_contracts_template_clause"),
            sa.ForeignKeyConstraint(
                ["template_id"],
                [f"{_TEMPLATE}.id"],
                # Scoped to this table only, without repeating the referenced
                # table, which is how the two constraints either side of this
                # one are already named. Spelling it the long way produced a
                # 65-character identifier, and PostgreSQL truncates at 63:
                # SQLAlchemy refuses to emit a name it knows will be cut, so
                # the revision raised before sending any DDL. Postgres runs DDL
                # in a transaction, so that rolled back the whole upgrade and
                # a site got none of the revisions rather than just this one.
                name="fk_oe_contracts_template_clause_template",
                ondelete="CASCADE",
            ),
            sa.UniqueConstraint(
                "template_id",
                "number",
                name="uq_oe_contracts_template_clause_number",
            ),
        )

    clause_indexes = _indexes(_CLAUSE)
    if _IX_CLAUSE_TEMPLATE not in clause_indexes:
        op.create_index(_IX_CLAUSE_TEMPLATE, _CLAUSE, ["template_id"])
    if _IX_CLAUSE_RISK not in clause_indexes:
        op.create_index(_IX_CLAUSE_RISK, _CLAUSE, ["risk_level"])

    # The contracts module may not be installed on a trimmed deployment; a
    # missing header table is not an error here, create_all will build it
    # complete with both columns when the module arrives.
    if _table_exists(_CONTRACT):
        contract_columns = _columns(_CONTRACT)
        if "template_code" not in contract_columns:
            op.add_column(_CONTRACT, sa.Column("template_code", sa.String(80), nullable=True))
        if "template_version" not in contract_columns:
            op.add_column(_CONTRACT, sa.Column("template_version", sa.Integer(), nullable=True))
        if _IX_CONTRACT_TEMPLATE_CODE not in _indexes(_CONTRACT):
            op.create_index(_IX_CONTRACT_TEMPLATE_CODE, _CONTRACT, ["template_code"])


def downgrade() -> None:
    if _table_exists(_CONTRACT):
        if _IX_CONTRACT_TEMPLATE_CODE in _indexes(_CONTRACT):
            op.drop_index(_IX_CONTRACT_TEMPLATE_CODE, table_name=_CONTRACT)
        contract_columns = _columns(_CONTRACT)
        # Going down loses which template version a contract was drawn from.
        # There is nowhere else to keep it: the whole point of the pair is that
        # it is not derivable from anything the older schema holds.
        if "template_version" in contract_columns:
            op.drop_column(_CONTRACT, "template_version")
        if "template_code" in contract_columns:
            op.drop_column(_CONTRACT, "template_code")

    if _table_exists(_CLAUSE):
        op.drop_table(_CLAUSE)
    if _table_exists(_TEMPLATE):
        op.drop_table(_TEMPLATE)
