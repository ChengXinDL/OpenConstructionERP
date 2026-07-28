# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""The doctor's PDF probe must import the way the upload path imports.

The probe spawns ``sys.executable -c "import <mod>"`` so a broken native
extension takes down a child instead of the diagnostic. That is right for a
normal install and wrong for the frozen desktop build, where ``sys.executable``
is the app binary and ``-c`` reaches the app's own CLI. Without the desktop
arm every healthy desktop install would be reported as a broken PDF reader.
"""

from __future__ import annotations

import sys

import pytest

from app import cli
from app.modules.takeoff.service import _use_in_process_pdf_parser


class TestDesktopPredicateDoesNotDrift:
    """The CLI restates the parser's condition; it must stay the same condition."""

    @pytest.mark.parametrize(
        ("frozen", "desktop_env"),
        [
            (False, None),
            (False, "1"),
            (False, "true"),
            (False, "YES"),
            (False, "on"),
            (False, "0"),
            (False, "no"),
            (False, ""),
            (True, None),
            (True, "0"),
        ],
    )
    def test_cli_predicate_matches_the_parser(
        self,
        monkeypatch: pytest.MonkeyPatch,
        frozen: bool,
        desktop_env: str | None,
    ) -> None:
        monkeypatch.setattr(sys, "frozen", frozen, raising=False)
        if desktop_env is None:
            monkeypatch.delenv("OE_DESKTOP", raising=False)
        else:
            monkeypatch.setenv("OE_DESKTOP", desktop_env)

        assert cli._pdf_reader_imports_in_process() == _use_in_process_pdf_parser()


class TestFrozenBuildIsNotProbedWithAChild:
    """On desktop the probe must import here, never spawn the app binary."""

    def test_frozen_build_does_not_spawn_a_subprocess(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(sys, "frozen", True, raising=False)

        import subprocess

        def _explode(*args: object, **kwargs: object) -> None:
            raise AssertionError(
                "doctor spawned sys.executable on a frozen build - that launches "
                "the app binary, not an interpreter, and reports a healthy "
                "install as a broken PDF reader"
            )

        monkeypatch.setattr(subprocess, "run", _explode)

        checks = cli.check_optional_extras()
        pdf = [c for c in checks if c.name == "PDF takeoff"]
        assert pdf, "the PDF takeoff check disappeared from the doctor output"
        assert pdf[0].status == "ok", f"a readable install reported as {pdf[0].status}: {pdf[0].detail}"

    def test_normal_install_still_uses_a_child(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(sys, "frozen", False, raising=False)
        monkeypatch.delenv("OE_DESKTOP", raising=False)

        seen: list[list[str]] = []
        import subprocess

        real_run = subprocess.run

        def _record(cmd: object, *args: object, **kwargs: object) -> object:
            if isinstance(cmd, list):
                seen.append([str(part) for part in cmd])
            return real_run(cmd, *args, **kwargs)  # type: ignore[arg-type]

        monkeypatch.setattr(subprocess, "run", _record)

        cli.check_optional_extras()

        imports = [cmd for cmd in seen if len(cmd) == 3 and cmd[1] == "-c"]
        assert imports, "the PDF probe stopped using a child interpreter"
        assert any("import pdfplumber" in cmd[2] for cmd in imports), (
            "pdfplumber is the primary reader and must be probed"
        )
        assert any("import pymupdf" in cmd[2] for cmd in imports), "pymupdf is the fallback reader and must be probed"
