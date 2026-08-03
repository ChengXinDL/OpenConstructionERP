# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Add oe_resources_assignment.activity_id.

A resource assignment could name a project, a to-do task or a work order, but
never the schedule activity it actually staffs. The Gantt row and the resource
booking had no reference to each other in either direction, so nothing could
answer "who is on this activity" or "which bar does this booking belong to".

This column is that reference. It is additive: ``task_id`` keeps its meaning
and its rows, and the two are independent, because a to-do task and a schedule
activity are different objects.

``ondelete`` is SET NULL rather than CASCADE. Deleting a schedule activity must
not delete the assignment history that hung off it - the hours were still
booked, the resource was still committed, and a planner reworking a schedule
would silently lose the record of both.

The FK is created only here, never on the ORM model, matching how ``task_id``
and ``contact_id`` are already declared in this table: test fixtures load the
resources models without necessarily loading the schedule ones, and an
ORM-level ForeignKey to a table absent from the metadata breaks ``create_all``.
Creating it is best-effort for the same reason ``contact_id``'s was in v3014 -
a partial install without the schedule module still gets the column.

The column type is ``String(36)`` on PostgreSQL too, not native ``uuid``. The
neighbouring v3014 columns say ``postgresql.UUID(as_uuid=True)``, and copying
that here produced a column PostgreSQL refused to hang the constraint off:
``key columns "activity_id" and "id" are of incompatible types: uuid and
character varying``. ``app.database.GUID`` is ``VARCHAR(36)`` on every dialect
and always has been (its own docstring counts 597 varchar id columns against
zero uuid), so ``oe_schedule_activity.id`` is text and the referring column has
to be text as well. This is the collision that docstring warns about, between a
schema built by ``create_all`` and one built by walking the chain.

Revision ID: v3272_assignment_activity_link
Revises: v3271_formwork_debrand
Create Date: 2026-08-03
"""

from __future__ import annotations

import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "v3272_assignment_activity_link"
down_revision: Union[str, Sequence[str], None] = "v3271_formwork_debrand"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")

_TABLE = "oe_resources_assignment"
_COLUMN = "activity_id"
_TARGET = "oe_schedule_activity"
_INDEX = "ix_oe_resources_assignment_activity_id"
_FK = "fk_oe_resources_assignment_activity_id_oe_schedule_activity"


def _columns(inspector: sa.engine.reflection.Inspector, table: str) -> set[str]:
    """Column names on ``table``, or an empty set when it does not exist."""
    if table not in inspector.get_table_names():
        return set()
    return {col["name"] for col in inspector.get_columns(table)}


def _has_index(inspector: sa.engine.reflection.Inspector, table: str, index: str) -> bool:
    """True when ``index`` already exists on ``table``."""
    if table not in inspector.get_table_names():
        return False
    return any(ix["name"] == index for ix in inspector.get_indexes(table))


def upgrade() -> None:
    """Add the column, its index, and the FK when the schedule table is there."""
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"
    # Same on every dialect, because ``GUID`` is. See the module docstring.
    guid_type = sa.String(36)
    inspector = sa.inspect(bind)

    existing = _columns(inspector, _TABLE)
    if not existing:
        # A partial install without the resources module. Not an error, and not
        # something that should stop an upgrade.
        logger.info("%s absent, nothing to add", _TABLE)
        return

    if _COLUMN in existing:
        logger.info("%s.%s already present", _TABLE, _COLUMN)
    else:
        op.add_column(_TABLE, sa.Column(_COLUMN, guid_type, nullable=True))
        logger.info("added %s.%s", _TABLE, _COLUMN)

    inspector = sa.inspect(bind)  # refresh after ALTER TABLE
    if not _has_index(inspector, _TABLE, _INDEX):
        op.create_index(_INDEX, _TABLE, [_COLUMN])

    # SQLite cannot ALTER TABLE ADD CONSTRAINT, and a schedule-less install has
    # nothing to point at. Both leave the column in place without the FK, which
    # is the same shape task_id and contact_id already ship in.
    if is_sqlite:
        logger.info("sqlite: %s left without an FK constraint", _COLUMN)
        return
    if _TARGET not in inspector.get_table_names():
        logger.info("%s absent, %s left without an FK constraint", _TARGET, _COLUMN)
        return
    if any(fk["name"] == _FK for fk in inspector.get_foreign_keys(_TABLE)):
        logger.info("%s already present", _FK)
        return

    # Inside a savepoint, or "best effort" is not best effort at all: a refused
    # constraint aborts the enclosing PostgreSQL transaction, so catching the
    # error still leaves every later statement - alembic's own version bump
    # included - failing with "current transaction is aborted". Rolling back to
    # the savepoint is what actually lets the upgrade carry on without the FK.
    savepoint = bind.begin_nested()
    try:
        op.create_foreign_key(_FK, _TABLE, _TARGET, [_COLUMN], ["id"], ondelete="SET NULL")
    except (sa.exc.OperationalError, sa.exc.ProgrammingError) as exc:  # pragma: no cover - partial install
        savepoint.rollback()
        logger.warning("could not create %s; column kept without the constraint: %r", _FK, exc)
    else:
        savepoint.commit()


def downgrade() -> None:
    """Drop the FK, the index and the column.

    Reversible without data loss beyond the link itself: the column holds a
    reference nothing else derives from, and every assignment keeps its
    resource, dates and allocation.
    """
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _COLUMN not in _columns(inspector, _TABLE):
        logger.info("%s.%s absent, nothing to drop", _TABLE, _COLUMN)
        return

    if any(fk["name"] == _FK for fk in inspector.get_foreign_keys(_TABLE)):
        try:
            op.drop_constraint(_FK, _TABLE, type_="foreignkey")
        except (sa.exc.OperationalError, sa.exc.ProgrammingError, NotImplementedError):  # pragma: no cover - sqlite
            pass

    if _has_index(inspector, _TABLE, _INDEX):
        op.drop_index(_INDEX, table_name=_TABLE)

    try:
        op.drop_column(_TABLE, _COLUMN)
    except (sa.exc.OperationalError, NotImplementedError):  # pragma: no cover - sqlite pre-batch
        pass
