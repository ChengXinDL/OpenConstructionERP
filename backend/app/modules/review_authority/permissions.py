# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Review-authority permission definitions."""

from app.core.permissions import Role, permission_registry


def register_review_authority_permissions() -> None:
    """Register permissions for the review-authority module."""
    permission_registry.register_module_permissions(
        "review_authority",
        {
            "review_authority.create": Role.EDITOR,
            "review_authority.read": Role.VIEWER,
            "review_authority.update": Role.EDITOR,
            "review_authority.delete": Role.MANAGER,
        },
    )
