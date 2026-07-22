# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Site-supervision permission definitions."""

from app.core.permissions import Role, permission_registry


def register_site_supervision_permissions() -> None:
    """Register permissions for the site-supervision module."""
    permission_registry.register_module_permissions(
        "site_supervision",
        {
            "site_supervision.create": Role.EDITOR,
            "site_supervision.read": Role.VIEWER,
            "site_supervision.update": Role.EDITOR,
            "site_supervision.delete": Role.MANAGER,
        },
    )
