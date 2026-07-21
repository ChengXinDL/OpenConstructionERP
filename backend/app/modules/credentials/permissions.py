# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Credentials registry permission definitions."""

from app.core.permissions import Role, permission_registry


def register_credentials_permissions() -> None:
    """Register permissions for the credentials registry."""
    permission_registry.register_module_permissions(
        "credentials",
        {
            "credentials.create": Role.EDITOR,
            "credentials.read": Role.VIEWER,
            "credentials.update": Role.EDITOR,
            "credentials.delete": Role.MANAGER,
        },
    )
