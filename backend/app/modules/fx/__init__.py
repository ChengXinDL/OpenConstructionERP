# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Currency / FX module.

A construction project is estimated in one currency, procured in another and
reported in a third, and all three move for the whole of a multi-year
programme. This module is the register that keeps that traceable: published
rate sets with their provenance, point-in-time lookup, per-project currency
policy with optional pinning, and revaluation that separates what moved because
the scope moved from what moved because the rate did.

Market rates come from the European Central Bank daily reference feed (EUR
based). Resolution falls back from the applicable rate set to the legacy
latest-rate cache and finally to a small bundled seed of major currencies, so
conversion degrades gracefully with no hard network dependency, and every
answer says which of the three it used. Optional purchasing-power-parity
conversion uses World Bank factors and reports "unavailable" rather than
failing when a factor is missing.
"""


async def on_startup() -> None:
    """Module startup hook - register RBAC permissions and validation rules."""
    from app.modules.fx.permissions import register_fx_permissions
    from app.modules.fx.validators import register_fx_rules

    register_fx_permissions()
    register_fx_rules()
