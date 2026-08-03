"""The converter health check has to notice a binary Windows refuses to start.

Issue #416. A user opened the BIM page and Windows put up a "Bad Image" box
naming Qt6Core.dll beside DgnExporter.exe, error 0xC000007B. Two separate
things were wrong, and the one that matters is not the one in the title.

The exit code was not in the set the health check recognises, so it fell
through to the branch that reports every unrecognised code as healthy. The
status card said the converter was fine while the operating system was
refusing to run it.

And the box itself is drawn by the loader in a process we started, so nothing
we write reaches the screen until somebody clicks OK on a dialog the
application does not know exists.

These tests pin the classification, which is pure logic and runs anywhere.
Whether the dialog is actually suppressed is a Windows behaviour: the call is
asserted here, and only a Windows machine can confirm the effect.
"""

from __future__ import annotations

import contextlib
import sys
from pathlib import Path
from typing import Any
from unittest import mock

import pytest

from app.modules.boq import cad_import


@pytest.fixture(autouse=True)
def _clear_health_cache() -> Any:
    """The check caches for five minutes, which would leak between tests."""
    cad_import._HEALTH_CACHE.clear()
    yield
    cad_import._HEALTH_CACHE.clear()


def _run_smoke(exit_code: int, stderr: bytes = b"") -> dict[str, Any]:
    """Drive smoke_test_converter over a converter that exits with a code."""
    completed = mock.Mock(returncode=exit_code, stdout=b"", stderr=stderr)
    with (
        mock.patch.object(cad_import, "find_converter", return_value=Path("C:/conv/dgn_windows/DgnExporter.exe")),
        mock.patch("subprocess.run", return_value=completed),
    ):
        return dict(cad_import.smoke_test_converter("dgn", force=True))


# The four codes are one family: the image never reaches its first
# instruction. Listed by name so a future reader can check them against the
# NTSTATUS tables rather than trusting the numbers here.
LOADER_FAILURES = [
    pytest.param(0xC0000135, id="dll-not-found"),
    pytest.param(0xC0000142, id="dll-init-failed"),
    pytest.param(0xC000007B, id="invalid-image-format"),
    pytest.param(0xC0000139, id="entrypoint-not-found"),
]


@pytest.mark.parametrize("status", LOADER_FAILURES)
def test_loader_failure_is_reported_as_failed(status: int) -> None:
    assert _run_smoke(status)["status"] == "failed"


@pytest.mark.parametrize("status", LOADER_FAILURES)
def test_loader_failure_is_caught_however_the_sign_arrives(status: int) -> None:
    """subprocess reports these as a negative int on some paths and unsigned on others."""
    assert _run_smoke(status - 0x1_0000_0000)["status"] == "failed"


def test_the_code_from_the_report_is_not_called_healthy() -> None:
    """The specific regression: 0xC000007B used to fall through to "ok"."""
    result = _run_smoke(0xC000007B)
    assert result["status"] == "failed"
    assert result["message"], "a failed converter must say why"


def test_bitness_mismatch_does_not_tell_the_user_to_redownload_plugins() -> None:
    """0xC000007B means every file is present and one is the wrong word size.

    Sending somebody to reinstall the Qt plugins here sends them to fetch the
    files they already have, which is the advice the other codes need and this
    one does not.
    """
    message = _run_smoke(0xC000007B)["message"]
    assert "architecture" in message.lower()
    assert "0xc000007b" in message.lower()
    assert "plugin" not in message.lower()


def test_missing_dll_still_names_the_runtime() -> None:
    message = _run_smoke(0xC0000135)["message"]
    assert "Qt6" in message
    assert "0xc0000135" in message.lower()


def test_an_ordinary_non_zero_exit_is_still_healthy() -> None:
    """The probe feeds a newline to a CAD converter, so it is meant to fail.

    Only a loader failure means the install is broken; a binary that starts
    and then rejects the input has proved everything this check asks of it.
    """
    assert _run_smoke(1)["status"] == "ok"
    assert _run_smoke(0)["status"] == "ok"
    # Neighbours of the recognised codes, to show the set is a list and not a
    # range that swallows whatever is nearby.
    assert _run_smoke(0xC0000136)["status"] == "ok"
    assert _run_smoke(0xC000007A)["status"] == "ok"


def test_the_probe_asks_windows_not_to_draw_its_own_dialog() -> None:
    """The suppression has to wrap the spawn, or the box appears before we can report.

    Asserted by ordering rather than by outcome: the effect is a Windows
    behaviour and this suite runs everywhere.
    """
    calls: list[str] = []
    completed = mock.Mock(returncode=0xC000007B, stdout=b"", stderr=b"")

    @contextlib.contextmanager
    def _tracking_guard() -> Any:
        calls.append("guard-enter")
        yield
        calls.append("guard-exit")

    def _tracking_run(*_args: Any, **_kwargs: Any) -> Any:
        calls.append("spawn")
        return completed

    with (
        mock.patch.object(cad_import, "find_converter", return_value=Path("C:/conv/dgn_windows/DgnExporter.exe")),
        mock.patch.object(cad_import, "_windows_loader_errors_stay_quiet", _tracking_guard),
        mock.patch("subprocess.run", _tracking_run),
    ):
        cad_import.smoke_test_converter("dgn", force=True)

    assert calls == ["guard-enter", "spawn", "guard-exit"]


@pytest.mark.skipif(sys.platform.startswith("win"), reason="the guard does real work on Windows")
def test_the_guard_is_inert_off_windows() -> None:
    """Linux and macOS already return a loader failure as an exit code."""
    with cad_import._windows_loader_errors_stay_quiet():
        pass
