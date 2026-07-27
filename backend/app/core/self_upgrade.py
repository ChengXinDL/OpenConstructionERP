# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Whether this build can upgrade itself with pip, and what to say when it cannot.

The desktop app ships as a PyInstaller sidecar, so ``sys.executable`` there is
the frozen binary rather than an interpreter. A ``[sys.executable, "-m", "pip",
"install", ...]`` command therefore feeds its own tokens straight back into this
application's argparse CLI, which answers ``invalid choice: 'pip'`` and shows
the user a usage dump where an upgrade should have been (issue #403). The
bundle carries no pip to fix that with either: on the desktop the installer
replaces the whole application.

Two places build that command - the ``/api/system/upgrade`` route and the
``upgrade`` CLI command - and both must refuse identically, so the decision and
the wording live here rather than being written out twice.
"""

from __future__ import annotations

import sys

RELEASES_URL = "https://github.com/datadrivenconstruction/OpenConstructionERP/releases/latest"

#: Shown verbatim to the user when a frozen build is asked to upgrade itself.
FROZEN_REFUSAL = (
    "The desktop app cannot upgrade itself with pip. Download the latest "
    f"installer from {RELEASES_URL} and run it over this install - your "
    "projects and settings stay where they are."
)


def is_frozen_build() -> bool:
    """True when running inside a PyInstaller bundle.

    Deliberately reads ``sys.frozen`` rather than the ``OE_DESKTOP`` environment
    variable that :func:`app.config.desktop_mode` also honours. What matters
    here is not "is this the desktop product" but the narrower, purely mechanical
    question "is ``sys.executable`` an interpreter that can run ``-m pip``".
    The Windows installer builds are desktop too, yet they run a real
    ``python.exe`` out of a private venv and upgrade themselves perfectly well.
    """
    return bool(getattr(sys, "frozen", False))
