# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""E-signature registry permission definitions."""

from app.core.permissions import Role, permission_registry


def register_signing_permissions() -> None:
    """Register permissions for the e-signature registry."""
    permission_registry.register_module_permissions(
        "signing",
        {
            "signing.create": Role.EDITOR,
            "signing.read": Role.VIEWER,
            "signing.update": Role.EDITOR,
            "signing.delete": Role.MANAGER,
            # Recording an attestation / decline is a working action, not an
            # administrative one: an editor on the project may register that a
            # signatory has signed or declined.
            "signing.attest": Role.EDITOR,
        },
    )
