# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Work-type route classifier permission definitions."""

from app.core.permissions import Role, permission_registry


def register_project_route_permissions() -> None:
    """Register permissions for the work-type route classifier."""
    permission_registry.register_module_permissions(
        "project_route",
        {
            "project_route.create": Role.EDITOR,
            "project_route.read": Role.VIEWER,
            "project_route.update": Role.EDITOR,
            "project_route.delete": Role.MANAGER,
        },
    )
