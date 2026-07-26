"""Report constraints the models declare that the connected database is missing.

``create_all`` builds a brand-new table with every constraint in its
``__table_args__``, but it skips tables that already exist, and
``postgres_auto_migrate`` heals only columns and indexes. An install that predates a
constraint and upgrades through that path keeps a table whose UNIQUE, CHECK and FOREIGN
KEY constraints never arrive, and nothing reports that they did not. The collision
handling written against those constraints then becomes unreachable code.

This script names what is absent. It is strictly read only: it opens a connection, runs
inspection queries and prints a report. It issues no DDL and no DML on any code path, so
it is safe to point at a production database.

Usage::

    python -m app.scripts.check_schema_constraints
    python -m app.scripts.check_schema_constraints --url postgresql://user@host/db

Exit codes: ``0`` nothing missing, ``1`` divergences found, ``2`` could not connect.
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, UniqueConstraint, create_engine, inspect

if TYPE_CHECKING:
    from sqlalchemy.engine import Connection


def _live_name(connection: Connection, declared: str) -> str:
    """Render a declared constraint name the way SQLAlchemy stores it.

    A name over PostgreSQL's 63-byte identifier limit is not plainly truncated: SQLAlchemy
    keeps a prefix and appends a 4-character hash, so comparing the declared name against
    the live one reports a constraint as missing when it is present under its shortened
    name. Ask the dialect for the same rendering it used at CREATE time.
    """
    rendered = connection.dialect.identifier_preparer.truncate_and_render_constraint_name(declared)
    return rendered.strip('"')


@dataclass
class Report:
    """Constraints present in the metadata and absent from the live database."""

    missing_unique: list[tuple[str, str, tuple[str, ...]]] = field(default_factory=list)
    missing_check: list[tuple[str, str]] = field(default_factory=list)
    missing_fk: list[tuple[str, str, tuple[str, ...], str]] = field(default_factory=list)
    nullable_mismatch: list[tuple[str, str]] = field(default_factory=list)
    absent_tables: list[str] = field(default_factory=list)

    @property
    def total(self) -> int:
        """Number of divergences found, excluding tables that do not exist yet."""
        return len(self.missing_unique) + len(self.missing_check) + len(self.missing_fk) + len(self.nullable_mismatch)


def _load_metadata() -> Any:
    """Import every model so ``Base.metadata`` is fully populated, then return ``Base``.

    Mirrors the discovery walk in ``alembic/env.py``: models live in each module's
    ``models`` submodule and are not registered by importing ``app.main``.
    """
    import importlib
    import pkgutil

    for mod in ("app.core.models_registry", "app.core.audit_log"):
        try:
            importlib.import_module(mod)
        except Exception:  # noqa: BLE001 - a module absent from a slim install is not fatal
            pass

    import app.modules

    for info in pkgutil.iter_modules(app.modules.__path__):
        try:
            importlib.import_module(f"app.modules.{info.name}.models")
        except Exception:  # noqa: BLE001 - modules without models, or optional deps
            pass

    from app.database import Base

    return Base


def find_missing(connection: Connection, base: Any) -> Report:
    """Compare model-declared constraints against the live schema.

    Args:
        connection: An open **sync** SQLAlchemy connection. Only inspection queries
            are issued through it.
        base: The declarative base whose ``metadata`` describes the expected schema.

    Returns:
        A :class:`Report` naming every constraint that the model declares and the
        database does not have.
    """
    inspector = inspect(connection)
    live_tables = set(inspector.get_table_names())
    report = Report()

    for table in base.metadata.sorted_tables:
        if table.name not in live_tables:
            # create_all builds a missing table whole, constraints included, so this
            # is not a divergence. Reported separately for context.
            report.absent_tables.append(table.name)
            continue

        # A unique INDEX over the same columns gives the same guarantee as a unique
        # CONSTRAINT, so accept either before calling one missing.
        live_unique_cols = {frozenset(uc["column_names"] or ()) for uc in inspector.get_unique_constraints(table.name)}
        live_unique_cols |= {
            frozenset(ix["column_names"] or ()) for ix in inspector.get_indexes(table.name) if ix.get("unique")
        }
        live_check_names = {c["name"] for c in inspector.get_check_constraints(table.name) if c.get("name")}
        live_fks = {
            (frozenset(fk["constrained_columns"] or ()), fk["referred_table"])
            for fk in inspector.get_foreign_keys(table.name)
        }
        live_nullable = {c["name"]: c["nullable"] for c in inspector.get_columns(table.name)}

        for constraint in table.constraints:
            if isinstance(constraint, UniqueConstraint):
                cols = tuple(c.name for c in constraint.columns)
                if frozenset(cols) not in live_unique_cols:
                    report.missing_unique.append((table.name, constraint.name or "", cols))
            elif isinstance(constraint, CheckConstraint):
                # An unnamed check cannot be matched by name, so it is not reported
                # rather than reported wrongly.
                if constraint.name and _live_name(connection, constraint.name) not in live_check_names:
                    report.missing_check.append((table.name, constraint.name))
            elif isinstance(constraint, ForeignKeyConstraint):
                cols = tuple(c.name for c in constraint.columns)
                referred = constraint.elements[0].column.table.name if constraint.elements else ""
                if (frozenset(cols), referred) not in live_fks:
                    report.missing_fk.append((table.name, constraint.name or "", cols, referred))

        for column in table.columns:
            # ADD COLUMN emits NOT NULL only alongside a DEFAULT, so a healed column
            # can be nullable where the model is not.
            if not column.nullable and live_nullable.get(column.name) is True:
                report.nullable_mismatch.append((table.name, column.name))

    return report


def _print(report: Report, *, verbose: bool) -> None:
    """Print the report in a form that names each finding."""
    if report.missing_unique:
        print(f"\nMissing UNIQUE constraints ({len(report.missing_unique)}):")
        for tname, cname, cols in sorted(report.missing_unique):
            print(f"  {tname}({', '.join(cols)})  expected {cname or '<unnamed>'}")
    if report.missing_check:
        print(f"\nMissing CHECK constraints ({len(report.missing_check)}):")
        for tname, cname in sorted(report.missing_check):
            print(f"  {tname}  expected {cname}")
    if report.missing_fk:
        print(f"\nMissing FOREIGN KEY constraints ({len(report.missing_fk)}):")
        for tname, cname, cols, referred in sorted(report.missing_fk):
            print(f"  {tname}({', '.join(cols)}) -> {referred}  expected {cname or '<unnamed>'}")
    if report.nullable_mismatch:
        print(f"\nColumns nullable in the database but NOT NULL in the model ({len(report.nullable_mismatch)}):")
        for tname, col in sorted(report.nullable_mismatch):
            print(f"  {tname}.{col}")
    if verbose and report.absent_tables:
        print(f"\nTables not present yet, create_all would build these whole ({len(report.absent_tables)}):")
        for tname in sorted(report.absent_tables):
            print(f"  {tname}")

    if report.total == 0:
        print("\nNo missing constraints. The live schema matches the models.")
    else:
        print(f"\n{report.total} divergences found.")


def main() -> int:
    """Entry point. Returns the process exit code."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    parser.add_argument(
        "--url",
        default=None,
        help="Sync database URL. Defaults to DATABASE_SYNC_URL, then DATABASE_URL.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Also list tables that do not exist on the target yet.",
    )
    args = parser.parse_args()

    url = args.url or os.environ.get("DATABASE_SYNC_URL") or os.environ.get("DATABASE_URL")
    if not url:
        print("No database URL. Pass --url or set DATABASE_SYNC_URL / DATABASE_URL.")
        return 2
    # asyncpg cannot drive a sync engine; swap the driver so the same URL works.
    url = url.replace("postgresql+asyncpg://", "postgresql://")

    # ``app.database`` builds an engine at import time and refuses a non-PostgreSQL
    # URL, so a run driven purely by --url needs the variable present before the
    # metadata import below.
    os.environ.setdefault("DATABASE_URL", url)

    base = _load_metadata()
    try:
        engine = create_engine(url)
        with engine.connect() as connection:
            report = find_missing(connection, base)
    except Exception as exc:  # noqa: BLE001 - a connection failure is a usage error, not a crash
        print(f"Could not inspect the database: {exc}")
        return 2

    _print(report, verbose=args.verbose)
    return 1 if report.total else 0


if __name__ == "__main__":
    raise SystemExit(main())
