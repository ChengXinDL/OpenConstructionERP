# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""cost_match: persisted match runs, results and review decisions.

Creates the three tables behind the cost-match review workflow:

* ``oe_cost_match_run``      - one submitted batch, pinned to a cost base
* ``oe_cost_match_result``   - one source line and the suggestion it received
* ``oe_cost_match_decision`` - one person's ruling on one result, append-only

Two design points are visible in the DDL and are deliberate.

The match snapshot is not a foreign key. ``suggested_cost_item_id`` and
``decided_cost_item_id`` are plain indexed UUID columns with the matched
item's code, description, unit, rate and currency copied alongside them.
A constraint into ``oe_costs_item`` would either block a cost-base re-import
or cascade a review history away with the rows it re-keys, and a confirmed
match has to stay auditable against the rate that was shown at confirm time
rather than today's.

Every NOT NULL column carries a ``server_default`` that matches the Python-side
``default`` on the ORM model. Losing either half is how a fresh install ends up
with rows the application cannot write, so the two are kept in step.

Idempotent by table: each table is created only when the inspector says it is
missing. A fresh install that ran ``Base.metadata.create_all`` first is a no-op
here, and an installation that never had the module is created from scratch.

Revision ID: v3263_cost_match_runs
Revises: v3262_formwork_rate_buildup
Create Date: 2026-07-31
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "v3263_cost_match_runs"
down_revision: Union[str, Sequence[str], None] = "v3262_formwork_rate_buildup"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_RUN = "oe_cost_match_run"
_RESULT = "oe_cost_match_result"
_DECISION = "oe_cost_match_decision"

# Creation order. The downgrade walks it in reverse so a child table is always
# dropped before the parent it points at.
_TABLES: tuple[str, ...] = (_RUN, _RESULT, _DECISION)


def _existing_tables() -> set[str]:
    """Table names already present in the target database."""
    inspector = sa.inspect(op.get_bind())
    return set(inspector.get_table_names())


def _create_run() -> None:
    op.create_table(
        _RUN,
        sa.Column("id", sa.String(36), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("source_label", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("source_locale", sa.String(length=12), nullable=False, server_default="en"),
        sa.Column("cost_source", sa.String(length=50), nullable=False, server_default="cwicr"),
        sa.Column("region", sa.String(length=50), nullable=True),
        sa.Column("catalog_id", sa.String(36), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="matched"),
        sa.Column("item_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("candidate_limit", sa.Integer(), nullable=False, server_default="40"),
        sa.Column("created_by", sa.String(36), nullable=True),
        sa.Column("tenant_id", sa.String(36), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["oe_projects_project.id"],
            name="fk_oe_cost_match_run_project_id_oe_projects_project",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_oe_cost_match_run_project_id", _RUN, ["project_id"])
    op.create_index("ix_oe_cost_match_run_cost_source", _RUN, ["cost_source"])
    op.create_index("ix_oe_cost_match_run_region", _RUN, ["region"])
    op.create_index("ix_oe_cost_match_run_catalog_id", _RUN, ["catalog_id"])
    op.create_index("ix_oe_cost_match_run_status", _RUN, ["status"])
    op.create_index("ix_oe_cost_match_run_created_by", _RUN, ["created_by"])
    op.create_index("ix_oe_cost_match_run_tenant_id", _RUN, ["tenant_id"])
    op.create_index("ix_cost_match_run_project_created", _RUN, ["project_id", "created_at"])


def _create_result() -> None:
    op.create_table(
        _RESULT,
        sa.Column("id", sa.String(36), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("run_id", sa.String(36), nullable=False),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("line_no", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("source_ref", sa.String(length=100), nullable=False, server_default=""),
        sa.Column("source_description", sa.Text(), nullable=False, server_default=""),
        sa.Column("source_unit", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("source_quantity", sa.Numeric(18, 3), nullable=True),
        sa.Column("tier", sa.String(length=20), nullable=False, server_default="unmatched"),
        sa.Column("confidence", sa.Numeric(6, 4), nullable=False, server_default="0"),
        sa.Column("tie", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("hint_code", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("reason_codes", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("factors", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("alternatives", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("suggested_cost_item_id", sa.String(36), nullable=True),
        sa.Column("suggested_code", sa.String(length=100), nullable=False, server_default=""),
        sa.Column("suggested_description", sa.Text(), nullable=False, server_default=""),
        sa.Column("suggested_unit", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("suggested_rate", sa.Numeric(18, 4), nullable=True),
        sa.Column("suggested_currency", sa.String(length=10), nullable=False, server_default=""),
        sa.Column("decision_state", sa.String(length=20), nullable=False, server_default="pending"),
        sa.ForeignKeyConstraint(
            ["run_id"],
            [f"{_RUN}.id"],
            name="fk_oe_cost_match_result_run_id_oe_cost_match_run",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_oe_cost_match_result_run_id", _RESULT, ["run_id"])
    op.create_index("ix_oe_cost_match_result_project_id", _RESULT, ["project_id"])
    op.create_index("ix_oe_cost_match_result_tier", _RESULT, ["tier"])
    op.create_index("ix_oe_cost_match_result_decision_state", _RESULT, ["decision_state"])
    op.create_index("ix_oe_cost_match_result_suggested_cost_item_id", _RESULT, ["suggested_cost_item_id"])
    op.create_index("ix_cost_match_result_queue", _RESULT, ["run_id", "tier", "decision_state"])
    op.create_index("ix_cost_match_result_run_line", _RESULT, ["run_id", "line_no"])


def _create_decision() -> None:
    op.create_table(
        _DECISION,
        sa.Column("id", sa.String(36), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("result_id", sa.String(36), nullable=False),
        sa.Column("run_id", sa.String(36), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("decision", sa.String(length=20), nullable=False, server_default="confirmed"),
        sa.Column("tier_at_decision", sa.String(length=20), nullable=False, server_default=""),
        sa.Column("confidence_at_decision", sa.Numeric(6, 4), nullable=False, server_default="0"),
        sa.Column("decided_cost_item_id", sa.String(36), nullable=True),
        sa.Column("decided_code", sa.String(length=100), nullable=False, server_default=""),
        sa.Column("decided_description", sa.Text(), nullable=False, server_default=""),
        sa.Column("decided_unit", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("decided_rate", sa.Numeric(18, 4), nullable=True),
        sa.Column("decided_currency", sa.String(length=10), nullable=False, server_default=""),
        sa.Column("decided_by", sa.String(36), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["result_id"],
            [f"{_RESULT}.id"],
            name="fk_oe_cost_match_decision_result_id_oe_cost_match_result",
            ondelete="CASCADE",
        ),
        # The service derives seq as max(seq) + 1, which two concurrent
        # reviewers can compute identically. This makes the collision a loud
        # failure instead of two rulings silently sharing a position.
        sa.UniqueConstraint("result_id", "seq", name="uq_oe_cost_match_decision_result_id_seq"),
    )
    op.create_index("ix_oe_cost_match_decision_result_id", _DECISION, ["result_id"])
    op.create_index("ix_oe_cost_match_decision_run_id", _DECISION, ["run_id"])
    op.create_index("ix_oe_cost_match_decision_decision", _DECISION, ["decision"])
    op.create_index("ix_oe_cost_match_decision_decided_cost_item_id", _DECISION, ["decided_cost_item_id"])
    op.create_index("ix_oe_cost_match_decision_decided_by", _DECISION, ["decided_by"])


_CREATORS = {
    _RUN: _create_run,
    _RESULT: _create_result,
    _DECISION: _create_decision,
}


def upgrade() -> None:
    existing = _existing_tables()
    if "oe_projects_project" not in existing:
        # The projects module has never been installed here, so the run table's
        # foreign key has nothing to point at. Creating a dangling FK would
        # fail the migration on a partial install rather than leave it usable,
        # so this is a documented no-op: install the module, run create_all or
        # the projects migration, and re-run.
        return
    for table in _TABLES:
        if table in existing:
            continue
        _CREATORS[table]()


def downgrade() -> None:
    existing = _existing_tables()
    for table in reversed(_TABLES):
        if table in existing:
            op.drop_table(table)
