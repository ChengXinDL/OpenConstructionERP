# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Deadlines module permission definitions."""

from app.core.permissions import Role, permission_registry


def register_deadlines_permissions() -> None:
    """Register permissions for the deadlines module."""
    permission_registry.register_module_permissions(
        "deadlines",
        {
            # Read the cross-module register (any project member).
            "deadlines.read": Role.VIEWER,
            # Trigger a manual sweep pass (ops / managers).
            "deadlines.sweep": Role.MANAGER,
        },
    )
