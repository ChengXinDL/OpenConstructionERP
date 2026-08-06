# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Tests for the module builder's spec and generator.

The generator's claim is strong and so the tests are correspondingly literal:
a spec that validates renders a module that compiles, that ruff accepts, and
whose own generated tests pass. Anything weaker - asserting that a rendered
file contains a substring - would pass on output that cannot be imported, and
the failure would then arrive on a user's server at startup.
"""

from __future__ import annotations

import compileall
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.modules.module_builder import generator
from app.modules.module_builder.spec import EntitySpec, FieldSpec, ModuleSpec, RuleSpec

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def a_spec(**overrides: object) -> ModuleSpec:
    """A realistic spec: every field type, every rule kind, project scoped."""
    payload: dict[str, object] = {
        "key": "scaffold_hire",
        "display_name": "Scaffold Hire",
        "description": "Track hired scaffolding, its rate and its off-hire date.",
        "entity": EntitySpec(
            name="hire",
            display_name="Hire",
            plural_name="Hires",
            fields=[
                FieldSpec(name="reference", label="Reference", type="text", required=True),
                FieldSpec(name="notes", label="Notes", type="long_text"),
                FieldSpec(name="bay_count", label="Bays", type="integer", required=True),
                FieldSpec(name="area_m2", label="Area", type="number", unit="m2"),
                FieldSpec(name="weekly_rate", label="Weekly rate", type="money", required=True),
                FieldSpec(name="on_hire_date", label="On hire", type="date", required=True),
                FieldSpec(name="off_hire_date", label="Off hire", type="date"),
                FieldSpec(name="inspected_at", label="Last inspection", type="datetime"),
                FieldSpec(name="is_tagged", label="Tagged", type="boolean"),
                FieldSpec(
                    name="status",
                    label="Status",
                    type="select",
                    options=["erected", "struck", "on hold"],
                    required=True,
                ),
            ],
        ),
        "rules": [
            RuleSpec(
                code="REFERENCE_REQUIRED",
                message="A hire needs a reference to be found by.",
                kind="required",
                field="reference",
            ),
            RuleSpec(
                code="RATE_POSITIVE",
                message="A weekly rate must be above zero.",
                kind="positive",
                field="weekly_rate",
            ),
            RuleSpec(
                code="BAYS_IN_RANGE",
                message="A hire covers between 1 and 500 bays.",
                kind="range",
                field="bay_count",
                min_value=1,
                max_value=500,
            ),
            RuleSpec(
                code="STATUS_KNOWN",
                message="Status must be one the register recognises.",
                kind="one_of",
                field="status",
            ),
            RuleSpec(
                code="INSPECTION_NOT_FUTURE",
                message="An inspection cannot be recorded before it happens.",
                kind="not_future",
                field="inspected_at",
            ),
            RuleSpec(
                code="OFF_HIRE_AFTER_ON_HIRE",
                message="Off hire cannot precede on hire.",
                kind="order",
                field="on_hire_date",
                other_field="off_hire_date",
            ),
        ],
    }
    payload.update(overrides)
    return ModuleSpec(**payload)  # type: ignore[arg-type]


class TestSpecRefusesWhatCannotWork:
    def test_reserved_field_name(self) -> None:
        with pytest.raises(ValidationError, match="reserved"):
            FieldSpec(name="id", label="Id")

    def test_metadata_is_reserved_too(self) -> None:
        # Parses as an identifier and collides with SQLAlchemy's own attribute.
        with pytest.raises(ValidationError, match="reserved"):
            FieldSpec(name="metadata", label="Meta")

    def test_camel_case_field_is_refused(self) -> None:
        with pytest.raises(ValidationError, match="snake_case"):
            FieldSpec(name="bayCount", label="Bays")

    def test_python_keyword_is_refused(self) -> None:
        with pytest.raises(ValidationError, match="keyword"):
            FieldSpec(name="class", label="Class")

    def test_select_needs_more_than_one_option(self) -> None:
        with pytest.raises(ValidationError, match="not a choice"):
            FieldSpec(name="status", label="Status", type="select", options=["only"])

    def test_non_select_may_not_carry_options(self) -> None:
        with pytest.raises(ValidationError, match="select options"):
            FieldSpec(name="title", label="Title", type="text", options=["a", "b"])

    def test_duplicate_field_names(self) -> None:
        with pytest.raises(ValidationError, match="duplicate field"):
            EntitySpec(
                name="hire",
                display_name="Hire",
                fields=[
                    FieldSpec(name="reference", label="A"),
                    FieldSpec(name="reference", label="B"),
                ],
            )

    def test_a_module_must_carry_rules(self) -> None:
        with pytest.raises(ValidationError):
            a_spec(rules=[])

    def test_rule_naming_a_missing_field(self) -> None:
        with pytest.raises(ValidationError, match="does not exist"):
            a_spec(rules=[RuleSpec(code="NO_SUCH", message="Nope, missing.", kind="required", field="ghost")])

    def test_numeric_rule_on_a_text_field(self) -> None:
        with pytest.raises(ValidationError, match="numeric"):
            a_spec(rules=[RuleSpec(code="BAD", message="Text is not a number.", kind="positive", field="reference")])

    def test_order_rule_between_non_dates(self) -> None:
        with pytest.raises(ValidationError, match="not dates"):
            a_spec(
                rules=[
                    RuleSpec(
                        code="BAD_ORDER",
                        message="These are not dates.",
                        kind="order",
                        field="bay_count",
                        other_field="area_m2",
                    )
                ]
            )

    def test_key_colliding_with_a_shipped_module(self) -> None:
        with pytest.raises(ValidationError, match="ships with the platform"):
            a_spec(key="projects")

    def test_version_must_be_semver(self) -> None:
        with pytest.raises(ValidationError, match="MAJOR.MINOR.PATCH"):
            a_spec(version="1.0")

    def test_a_sound_spec_validates(self) -> None:
        spec = a_spec()
        assert spec.module_name == "oe_scaffold_hire"
        assert spec.table_name == "oe_scaffold_hire_hire"
        assert spec.class_name == "Hire"


class TestRendering:
    def test_every_expected_file_is_rendered(self) -> None:
        paths = {f.path for f in generator.render(a_spec())}
        assert {
            "manifest.py",
            "models.py",
            "schemas.py",
            "repository.py",
            "service.py",
            "router.py",
            "validators.py",
            "permissions.py",
            "schema.py",
            "spec.json",
            "locales/en.json",
            "README.md",
        } <= paths

    def test_rendering_is_deterministic(self) -> None:
        # spec.json carries a timestamp, so it is the one file allowed to move.
        first = {f.path: f.content for f in generator.render(a_spec())}
        second = {f.path: f.content for f in generator.render(a_spec())}
        for path in first:
            if path == "spec.json":
                continue
            assert first[path] == second[path], f"{path} is not deterministic"

    def test_money_is_never_a_float(self) -> None:
        """The platform's own decimal column, not a bare Numeric.

        Plain Numeric hands back a float on backends that have no decimal type,
        so a rate written as 1450.75 can come back as 1450.7499999. MoneyType
        binds and returns Decimal on every backend and still compiles to
        NUMERIC(18, 2) on PostgreSQL - which the DDL test checks separately.
        """
        models = next(f for f in generator.render(a_spec()) if f.path == "models.py").content
        assert "MoneyType(18, 2)" in models
        assert "Float" not in models

    def test_permissions_are_registered_not_just_named(self) -> None:
        """Defining a registration function nobody calls registers nothing.

        A permission the registry has never heard of is denied to everyone
        except an administrator, so a module whose hook is missing works for
        whoever tested it as an admin and for no one else.
        """
        rendered = {f.path: f.content for f in generator.render(a_spec())}
        assert "register_module_permissions" in rendered["permissions.py"]
        # The loader awaits on_startup after importing the package. That is the
        # only place the call can go: import time is too early for anything
        # that touches the database, and nothing else imports permissions.py.
        assert "async def on_startup()" in rendered["__init__.py"]
        assert "register_scaffold_hire_permissions()" in rendered["__init__.py"]

    def test_the_startup_hook_also_creates_the_table(self) -> None:
        """Nothing else will. The module has no migration and never can have one."""
        init = next(f for f in generator.render(a_spec()) if f.path == "__init__.py").content
        assert "await ensure_table(engine)" in init

    def test_deleting_is_not_the_same_permission_as_writing(self) -> None:
        rendered = {f.path: f.content for f in generator.render(a_spec())}
        assert '"scaffold_hire.delete": Role.MANAGER' in rendered["permissions.py"]
        assert 'require_permission("scaffold_hire.delete")' in rendered["router.py"]

    def test_locales_are_english_only(self) -> None:
        paths = {f.path for f in generator.render(a_spec())}
        assert [p for p in paths if p.startswith("locales/")] == ["locales/en.json"]


class TestWriting:
    def test_write_refuses_to_overwrite(self, tmp_path: Path) -> None:
        spec = a_spec()
        generator.write(spec, tmp_path)
        with pytest.raises(FileExistsError):
            generator.write(spec, tmp_path)

    def test_a_failed_write_leaves_nothing_behind(self, tmp_path: Path, monkeypatch) -> None:
        spec = a_spec()
        real = generator.render

        def explode(s):
            files = real(s)
            files[3] = generator.GeneratedFile("models.py", "fine")
            raise RuntimeError("disk gave out")

        monkeypatch.setattr(generator, "render", explode)
        with pytest.raises(RuntimeError):
            generator.write(spec, tmp_path)
        assert not (tmp_path / spec.key).exists()

    def test_files_are_written_with_unix_newlines(self, tmp_path: Path) -> None:
        # Same spec, same bytes, whichever operating system generated it.
        generator.write(a_spec(), tmp_path)
        raw = (tmp_path / "scaffold_hire" / "models.py").read_bytes()
        assert b"\r\n" not in raw


class TestTheGeneratedModuleIsReal:
    """Compiles, lints, and passes the tests it came with."""

    @pytest.fixture
    def written(self, tmp_path: Path) -> Path:
        generator.write(a_spec(), tmp_path)
        return tmp_path / "scaffold_hire"

    def test_it_compiles(self, written: Path) -> None:
        assert compileall.compile_dir(str(written), quiet=1, force=True), "the generated module does not compile"

    def test_ruff_accepts_it(self, written: Path) -> None:
        result = subprocess.run(
            ["uvx", "ruff@0.15.20", "check", "--line-length", "120", str(written)],
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode == 127 or "not found" in (result.stderr or "").lower():
            pytest.skip("ruff is not available in this environment")
        assert result.returncode == 0, result.stdout + result.stderr

    def test_its_own_tests_pass(self, written: Path, tmp_path: Path) -> None:
        """The generated validator, exercised by the generated tests.

        Run in a subprocess against the real module tree, with the temp root on
        the import path, so the generated ``app.modules.<key>`` imports resolve
        exactly as they will on a user's instance.
        """
        from app.core import module_runtime_root as rr

        before = list(rr._package_path())
        rr.attach_runtime_root(tmp_path)
        try:
            result = subprocess.run(
                [sys.executable, "-m", "pytest", str(written / "tests"), "-q", "--no-header", "-p", "no:cacheprovider"],
                capture_output=True,
                text=True,
                timeout=600,
                cwd=str(BACKEND_ROOT),
                env={**_clean_env(), rr.ENV_VAR: str(tmp_path)},
            )
        finally:
            rr._package_path()[:] = before
        assert result.returncode == 0, result.stdout + result.stderr
        assert "passed" in result.stdout


def a_minimal_spec() -> ModuleSpec:
    """The other end of the range: one text field, no project, no dates.

    The full spec exercises every branch and therefore uses every import the
    generator could emit. This one uses almost none, which is what catches an
    import block written as a fixed list.
    """
    return ModuleSpec(
        key="site_notice",
        display_name="Site Notice",
        entity=EntitySpec(
            name="notice",
            display_name="Notice",
            project_scoped=False,
            fields=[FieldSpec(name="title", label="Title", type="text", required=True)],
        ),
        rules=[RuleSpec(code="TITLE_REQUIRED", message="A notice needs a title.", kind="required", field="title")],
    )


class TestASpecThatUsesAlmostNothing:
    @pytest.fixture
    def written(self, tmp_path: Path) -> Path:
        generator.write(a_minimal_spec(), tmp_path)
        return tmp_path / "site_notice"

    def test_it_compiles(self, written: Path) -> None:
        assert compileall.compile_dir(str(written), quiet=1, force=True)

    def test_ruff_accepts_it(self, written: Path) -> None:
        """An unused import is a hard error here, which is the point.

        The generator emits imports per field type. A spec with no money, no
        dates and no project would otherwise carry Numeric, Date and
        ForeignKey that nothing references.
        """
        result = subprocess.run(
            ["uvx", "ruff@0.15.20", "check", "--line-length", "120", str(written)],
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode == 127 or "not found" in (result.stderr or "").lower():
            pytest.skip("ruff is not available in this environment")
        assert result.returncode == 0, result.stdout + result.stderr

    def test_it_carries_no_project_column(self, written: Path) -> None:
        models = (written / "models.py").read_text(encoding="utf-8")
        assert "project_id" not in models
        assert "ForeignKey" not in models


class TestTheTableActuallyExists:
    """The generated module creates its own table, and only its own.

    A runtime module is outside Alembic's history, so nothing else will ever
    create this table. Rendering a correct ``models.py`` is not the claim being
    made here: the claim is that after install there is a table on the database
    that accepts the module's own rows.
    """

    @pytest.fixture
    def installed(self, tmp_path: Path):
        """The generated module, imported for real, then unregistered.

        Importing the model registers its table on the process-wide
        ``Base.metadata``. Left there, the next test to import it would fail on
        a duplicate table and the failure would land nowhere near its cause.
        """
        import importlib

        from app.core import module_runtime_root as rr
        from app.database import Base

        spec = a_spec()
        generator.write(spec, tmp_path)
        before = list(rr._package_path())
        rr.attach_runtime_root(tmp_path)
        importlib.invalidate_caches()
        try:
            yield spec, importlib.import_module(f"app.modules.{spec.key}.schema")
        finally:
            rr._package_path()[:] = before
            for name in [n for n in list(sys.modules) if n.startswith(f"app.modules.{spec.key}")]:
                del sys.modules[name]
            existing = Base.metadata.tables.get(spec.table_name)
            if existing is not None:
                Base.metadata.remove(existing)
            Base.registry._class_registry.pop(spec.class_name, None)
            importlib.invalidate_caches()

    def test_the_ddl_postgres_would_run_is_the_ddl_we_meant(self, installed) -> None:
        """Production is PostgreSQL, so that is the dialect that has to accept it."""
        from sqlalchemy.dialects import postgresql
        from sqlalchemy.schema import CreateTable

        spec, schema = installed
        ddl = str(CreateTable(schema.table()).compile(dialect=postgresql.dialect()))

        assert f"CREATE TABLE {spec.table_name} (" in ddl
        # Money keeps its cents. A rate rendered as DOUBLE PRECISION is a defect
        # the user finds in an invoice, months later.
        assert "weekly_rate NUMERIC(18, 2) NOT NULL" in ddl
        assert "area_m2 NUMERIC(18, 4)" in ddl
        assert "PRIMARY KEY (id)" in ddl
        assert "FOREIGN KEY(project_id) REFERENCES oe_projects_project (id) ON DELETE CASCADE" in ddl
        assert "DOUBLE PRECISION" not in ddl

    def test_the_table_is_created_and_holds_a_row(self, installed) -> None:
        import uuid
        from datetime import date
        from decimal import Decimal

        from sqlalchemy import create_engine, insert, select

        _, schema = installed
        engine = create_engine("sqlite://")
        try:
            schema.create_table(engine)
            table = schema.table()
            row_id, project_id = uuid.uuid4(), uuid.uuid4()
            with engine.begin() as connection:
                connection.execute(
                    insert(table).values(
                        id=row_id,
                        project_id=project_id,
                        reference="SC-014",
                        bay_count=12,
                        weekly_rate=Decimal("1450.75"),
                        on_hire_date=date(2026, 3, 1),
                        status="erected",
                    )
                )
                found = connection.execute(select(table).where(table.c.id == row_id)).mappings().one()

            assert found["reference"] == "SC-014"
            assert found["bay_count"] == 12
            assert Decimal(str(found["weekly_rate"])) == Decimal("1450.75")
            assert found["project_id"] == project_id
            # Not required by the spec, so it has to be nullable in the table too.
            assert found["off_hire_date"] is None
        finally:
            engine.dispose()

    def test_it_creates_that_table_and_nothing_else(self, installed) -> None:
        """The whole point of scoping ``create_all`` to one table.

        ``Base.metadata`` carries every table the platform owns. An unscoped
        create_all would raise the entire schema outside Alembic and still look
        green here, so the count is what is asserted, not the presence.
        """
        from sqlalchemy import create_engine, inspect

        from app.database import Base

        spec, schema = installed
        assert len(Base.metadata.tables) > 50, "metadata is too small for this test to mean anything"

        engine = create_engine("sqlite://")
        try:
            schema.create_table(engine)
            tables = set(inspect(engine).get_table_names())
        finally:
            engine.dispose()

        assert tables == {spec.table_name}

    def test_creating_twice_is_not_an_error(self, installed) -> None:
        """Install, restart, reinstall. All three call this."""
        from sqlalchemy import create_engine, inspect

        spec, schema = installed
        engine = create_engine("sqlite://")
        try:
            schema.create_table(engine)
            schema.create_table(engine)
            assert set(inspect(engine).get_table_names()) == {spec.table_name}
        finally:
            engine.dispose()

    def test_drop_takes_the_table_away_and_tolerates_its_absence(self, installed) -> None:
        from sqlalchemy import create_engine, inspect

        _, schema = installed
        engine = create_engine("sqlite://")
        try:
            schema.create_table(engine)
            schema.drop_table(engine)
            assert inspect(engine).get_table_names() == []
            schema.drop_table(engine)
        finally:
            engine.dispose()

    # ensure_table / remove_table run against the platform's async engine and
    # are covered in tests/pg/test_module_builder_table.py. There is no async
    # SQLite driver in this environment, and adding a dependency so that a test
    # can avoid the database it actually runs on would prove the wrong thing.


def _clean_env() -> dict[str, str]:
    import os

    env = dict(os.environ)
    env.pop("PYTHONDONTWRITEBYTECODE", None)
    return env
