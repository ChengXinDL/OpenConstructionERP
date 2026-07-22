# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Authority-submission permission definitions."""

from app.core.permissions import Role, permission_registry


def register_authority_submission_permissions() -> None:
    """Register permissions for the authority-submission factory."""
    permission_registry.register_module_permissions(
        "authority_submission",
        {
            "authority_submission.create": Role.EDITOR,
            "authority_submission.read": Role.VIEWER,
            "authority_submission.update": Role.EDITOR,
            "authority_submission.delete": Role.MANAGER,
            # Marking a document submitted to an authority is a delivery act,
            # not a routine edit - gate it at manager.
            "authority_submission.submit": Role.MANAGER,
        },
    )
