# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Source-data register permission definitions."""

from app.core.permissions import Role, permission_registry


def register_source_data_permissions() -> None:
    """Register permissions for the source-data register."""
    permission_registry.register_module_permissions(
        "source_data",
        {
            "source_data.create": Role.EDITOR,
            "source_data.read": Role.VIEWER,
            "source_data.update": Role.EDITOR,
            "source_data.delete": Role.MANAGER,
        },
    )
