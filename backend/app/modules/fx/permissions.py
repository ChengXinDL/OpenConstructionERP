# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Currency / FX module permission definitions.

The register is read by anyone who reads money, refreshed by anyone who prices,
and pinned or hand-entered only by someone accountable for the figures a project
is held to. That last distinction is why locking is a manager-level act: a
locked rate set is a promise that an estimate can be reproduced.
"""

from app.core.permissions import Role, permission_registry


def register_fx_permissions() -> None:
    """Register permissions for the FX module."""
    permission_registry.register_module_permissions(
        "fx",
        {
            # Read rates, rate sets, policies and conversions.
            "fx.read": Role.VIEWER,
            # Pull the live feed into the register.
            "fx.refresh": Role.EDITOR,
            # Record a hand-entered rate set and set a project's FX policy.
            "fx.manage": Role.MANAGER,
        },
    )
