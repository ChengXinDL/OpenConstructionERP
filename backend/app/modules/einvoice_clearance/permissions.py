# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""E-invoice clearance permission definitions.

``RequirePermission`` denies a key no module registered, and the admin check
short-circuits above it, so a module without a ``permissions.py`` ships
endpoints only an admin can reach - and every admin-authenticated test still
passes, which is why this file is load-bearing rather than paperwork.

Four keys, split where the consequence changes:

* ``read`` and ``write`` are the usual pair. Writing covers registrations and
  preparing a document, both of which are reversible by editing.
* ``submit`` is MANAGER because it is not reversible by editing. Putting a
  document to a tax authority creates a record outside this system, and in a
  clearance country it is the act that makes the invoice legally exist.
* ``cancel`` is MANAGER for the same reason from the other side: withdrawing a
  cleared document is a declaration to the authority that an invoice it holds
  should not have been issued.

That mirrors ``daily_diary.sign``, which is MANAGER on the same principle - the
signature, not the typing, is the consequential act.
"""

from app.core.permissions import Role, permission_registry


def register_einvoice_clearance_permissions() -> None:
    """Register permissions for the E-invoice clearance module."""
    permission_registry.register_module_permissions(
        "einvoice_clearance",
        {
            "einvoice_clearance.read": Role.VIEWER,
            "einvoice_clearance.write": Role.EDITOR,
            "einvoice_clearance.submit": Role.MANAGER,
            "einvoice_clearance.cancel": Role.MANAGER,
        },
    )


__all__ = ["register_einvoice_clearance_permissions"]
