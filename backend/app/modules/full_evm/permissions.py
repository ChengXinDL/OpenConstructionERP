# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Full EVM module permission definitions."""

from app.core.permissions import Role, permission_registry


def register_full_evm_permissions() -> None:
    """Register permissions for the Full EVM module.

    EVM data is read-heavy and tied to project finances, so anyone with VIEWER
    on the project can read it and EDITOR can record measurements, recompute
    forecasts and acknowledge alerts.

    Two operations sit above that. Deleting a baseline removes the measurement
    base under a reported history, and approving one changes the number every
    future variance on the project is measured against - neither is an editing
    action, so both need MANAGER.
    """
    permission_registry.register_module_permissions(
        "full_evm",
        {
            "full_evm.read": Role.VIEWER,
            "full_evm.create": Role.EDITOR,
            "full_evm.update": Role.EDITOR,
            "full_evm.delete": Role.MANAGER,
            "full_evm.approve": Role.MANAGER,
        },
    )
