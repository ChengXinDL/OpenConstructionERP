# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Resources (Graphical Resource Planning) module.

Manages resources (people, crews, equipment, subcontractors) with skills,
certifications, availability windows, assignments to projects/tasks/work orders,
conflict detection, skill-based matching, and resource requests.
"""


async def on_startup() -> None:
    """Module startup hook (called by the module loader after mount).

    Registers the module's permissions and its validation rules. Both are
    idempotent - the registries key on code and on rule id - so a hot reload
    re-registers cleanly.

    The rules have to be registered here and not only where they are used: a
    rule set that resolves to no rules comes back from the engine as
    unsupported, which in the payload is indistinguishable from "the rules ran
    and found nothing wrong".
    """
    from app.modules.resources.permissions import register_resources_permissions
    from app.modules.resources.validators import register_resources_rules

    register_resources_permissions()
    register_resources_rules()
