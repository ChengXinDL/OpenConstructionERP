# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Payment clock permission definitions.

``RequirePermission`` denies a key the registry has never seen, and an admin
request short-circuits above that check. A module that forgets to register is
therefore reachable by admins, passes every admin-authenticated test, and is a
403 for everyone else in production. These three registrations are the module
being usable at all.

Three keys, split where the consequences differ:

* ``payment_clock.read``   VIEWER  - see the dates, the notices and the findings.
* ``payment_clock.write``  EDITOR  - open a clock, record a notice that was
  served, mark an application paid. This is site and commercial work.
* ``payment_clock.manage`` MANAGER - overwrite the computed statutory dates by
  hand, delete a clock, and reload the regime catalogue. Overriding is the one
  action that silences the arithmetic the module exists for, so it sits with
  the role that answers for the contract rather than with the role that files
  the paperwork.
"""

from app.core.permissions import Role, permission_registry


def register_payment_clock_permissions() -> None:
    """Register permissions for the Payment Clock module."""
    permission_registry.register_module_permissions(
        "payment_clock",
        {
            "payment_clock.read": Role.VIEWER,
            "payment_clock.write": Role.EDITOR,
            "payment_clock.manage": Role.MANAGER,
        },
    )
