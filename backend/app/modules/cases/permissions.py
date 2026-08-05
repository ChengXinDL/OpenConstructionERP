# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Cases module permission definitions.

``RequirePermission`` denies an unregistered permission, so a module that
never registers its own is reachable by admins and by nobody else. Both of
these are therefore load-bearing, not paperwork.

``cases.write`` is EDITOR and covers authoring *and* pinning. Pinning is
arguably lighter than authoring, but a viewer curating a set for a project
would be writing to the account, and viewer is the role that reads. Deleting
is not split out to MANAGER the way it is elsewhere: you can only delete a
case you wrote yourself, so the usual reason for that split does not apply.
"""

from app.core.permissions import Role, permission_registry


def register_cases_permissions() -> None:
    """Register permissions for the Cases module."""
    permission_registry.register_module_permissions(
        "cases",
        {
            "cases.read": Role.VIEWER,
            "cases.write": Role.EDITOR,
        },
    )
