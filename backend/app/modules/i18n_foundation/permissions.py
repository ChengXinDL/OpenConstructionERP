# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Internationalization Foundation permission definitions.

One route in this module writes: the ECB exchange-rate fetch reaches out to
the European Central Bank and stores every new daily reference rate it finds.
Everything else here reads.

It used to be gated on the bare literal ``"admin"``, which no module ever
registers. ``RequirePermission`` returns False for an unknown key and admin
short-circuits above that check, so the route behaved as admin-only and no
test could see the difference, because the fixtures authenticate as an admin.
The cost was invisible in the same way: the admin permission matrix could
never delegate this route, since ``set_min_role`` on an unregistered key
raises.

ADMIN rather than MANAGER because the rates it writes are the ones every
converted amount in the product is then computed from.
"""

from app.core.permissions import Role, permission_registry


def register_i18n_foundation_permissions() -> None:
    """Register permissions for the Internationalization Foundation module."""
    permission_registry.register_module_permissions(
        "i18n_foundation",
        {
            "i18n_foundation.exchange_rates.fetch": Role.ADMIN,
        },
    )
