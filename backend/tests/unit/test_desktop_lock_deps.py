"""Guard: the desktop PyInstaller lock carries the right dependency set.

The desktop build installs dependencies from ``requirements-desktop.lock`` and
then runs ``pip install -e . --no-deps``, so anything missing from the lock is
simply absent from the frozen sidecar. A stale lock once shipped without PyMuPDF
/ OpenCV / laspy / lazrs / pypdf (PDF takeoff, raster room detection, point-cloud
reads, PDF stamping) and with pandas 3.x even though ``pyproject.toml`` caps it
below 3.0 - silently breaking those features on the desktop channel only, while
the wheel kept working. This test fails fast if the lock drifts away from the
declared base dependencies again.

The lock is now compiled with one extra, ``[semantic-clients]``, so the checks
run in both directions: the vector-store clients it exists to ship must be
present, and the heavy embedding stacks must not be. Both failures are silent
at build time - a lock missing the clients still builds a working-looking
installer, and a lock that pulled torch still builds, just gigabytes larger.

It is a pure file-parsing test (no application import), so it runs anywhere the
test suite is collected.
"""

import re
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[2]
_LOCK = _BACKEND / "requirements-desktop.lock"

# The command that regenerates the lock. It carries ``--extra
# semantic-clients``: without it uv resolves the base dependencies only and
# silently drops the vector-store clients below, which is the exact drift this
# file exists to catch.
_REGEN = (
    "uv pip compile pyproject.toml --universal --python-version 3.12 "
    "--extra semantic-clients -o requirements-desktop.lock"
)

# Base deps whose absence silently breaks a desktop-only feature. Each is an
# unconditional (non-optional, non-platform-gated) dependency declared in
# pyproject.toml that is imported by application code.
_REQUIRED_BASE_DEPS = (
    "pymupdf",
    "opencv-python-headless",
    "laspy",
    "lazrs",
    "pypdf",
    "pandas",
)

# Vector-store clients from the [semantic-clients] extra. qdrant-client opens
# the CWICR match store, and it is imported inside a function body, so a lock
# without it produces a sidecar that answers an empty 200 from /match-elements
# instead of failing loudly. lancedb is deliberately absent: it is 157 MB for a
# generic semantic store that has no encoder in a stock install anyway, so it
# stays in [vector]. Absent, not forbidden - it is a client, not an embedder,
# and an operator who installs [vector] on top is doing nothing wrong.
_REQUIRED_CLIENT_DEPS = ("qdrant-client",)

# The other half of the same decision: the clients ship, the encoders do not.
# FlagEmbedding and sentence-transformers pull torch, which the PyInstaller
# spec excludes outright and which would add gigabytes to every installer.
# Anything that drags one of these into the lock has resolved an extra it
# should not have.
_FORBIDDEN_HEAVY_DEPS = (
    "torch",
    "flagembedding",
    "sentence-transformers",
)


def _lock_versions() -> dict[str, str]:
    """Map normalised distribution name -> pinned version from the lock."""
    versions: dict[str, str] = {}
    for line in _LOCK.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^([A-Za-z0-9._-]+)==([^\s;]+)", line)
        if match:
            versions[match.group(1).lower()] = match.group(2)
    return versions


def test_required_base_deps_present_in_desktop_lock() -> None:
    versions = _lock_versions()
    missing = [dep for dep in _REQUIRED_BASE_DEPS if dep.lower() not in versions]
    assert not missing, (
        f"requirements-desktop.lock is missing base deps imported by the app: {missing}. Regenerate with: {_REGEN}"
    )


def test_vector_clients_present_in_desktop_lock() -> None:
    versions = _lock_versions()
    missing = [dep for dep in _REQUIRED_CLIENT_DEPS if dep.lower() not in versions]
    assert not missing, (
        f"requirements-desktop.lock is missing the [semantic-clients] vector-store client: {missing}. "
        "A lock compiled without --extra semantic-clients looks healthy but ships a sidecar "
        f"whose /match-elements returns nothing. Regenerate with: {_REGEN}"
    )


def test_heavy_embedders_absent_from_desktop_lock() -> None:
    versions = _lock_versions()
    present = [dep for dep in _FORBIDDEN_HEAVY_DEPS if dep.lower() in versions]
    assert not present, (
        f"requirements-desktop.lock resolved heavy embedding deps: {present}. Only "
        "the [semantic-clients] extra belongs in the desktop build; [semantic] and "
        "[all] pull torch, which the PyInstaller spec excludes and which would add "
        f"gigabytes to every installer. Regenerate with: {_REGEN}"
    )


def test_pandas_pinned_below_3_in_desktop_lock() -> None:
    versions = _lock_versions()
    pandas_version = versions.get("pandas")
    assert pandas_version is not None, "pandas missing from requirements-desktop.lock"
    major = int(pandas_version.split(".")[0])
    assert major < 3, (
        f"requirements-desktop.lock pins pandas {pandas_version}; pyproject.toml "
        "caps it <3 (pandas 3.0 changed string-column type inference). Regenerate "
        "the lock so it respects the cap."
    )
