# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Test bootstrap for the pipelines module tests.

Importing ``app.database`` builds the async engine from
``settings.database_url`` at import time and raises unless the URL is a
PostgreSQL DSN. Some node runners (e.g. ``source.validation_findings``) import
ORM models lazily, so a runner-level test transitively needs the engine to be
importable even when it never opens a real connection.

The whole-suite ``tests/conftest.py`` already boots a throwaway embedded
PostgreSQL when ``DATABASE_URL`` is unset, but that conftest only applies to
the ``tests/`` tree. When this module's tests are collected on their own
(``pytest app/modules/pipelines/tests``) that bootstrap does not run, so we
mirror it here. The guard on ``DATABASE_URL`` keeps it a no-op whenever CI or
the whole-suite conftest has already provided a database.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

if not os.environ.get("DATABASE_URL", "").strip():
    import atexit

    from app.core import embedded_pg

    _PG_DATA_DIR = Path(tempfile.mkdtemp(prefix="oe-pipelines-tests-pg-"))
    if not embedded_pg.boot(_PG_DATA_DIR):
        raise RuntimeError(
            "could not boot embedded PostgreSQL for the pipelines module tests; "
            "set DATABASE_URL to point at an external PostgreSQL instead"
        )
    atexit.register(embedded_pg.shutdown)
