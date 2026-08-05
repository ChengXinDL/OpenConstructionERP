# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Internationalization Foundation module package.

The module loader auto-imports ``router``, ``models``, ``hooks``, ``events``,
``validators`` and ``pipeline_nodes``, but never ``permissions.py``. The only
thing that runs a module's permission registration is this file, through the
``on_startup`` hook the loader calls once the module has loaded.
"""


async def on_startup() -> None:
    """Register this module's permissions once the module is loaded."""
    from app.modules.i18n_foundation.permissions import (
        register_i18n_foundation_permissions,
    )

    register_i18n_foundation_permissions()
