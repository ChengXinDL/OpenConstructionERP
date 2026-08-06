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
        models = next(f for f in generator.render(a_spec()) if f.path == "models.py").content
        assert "Numeric(18, 2)" in models
        assert "Float" not in models

    def test_permissions_are_registered_not_just_named(self) -> None:
        content = next(f for f in generator.render(a_spec()) if f.path == "permissions.py").content
        assert "register_module_permissions" in content
        # Called at import, not merely defined: a registration function nobody
        # invokes leaves every permission unknown, and unknown is denied.
        assert content.rstrip().endswith("register_scaffold_hire_permissions()")

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


def _clean_env() -> dict[str, str]:
    import os

    env = dict(os.environ)
    env.pop("PYTHONDONTWRITEBYTECODE", None)
    return env
