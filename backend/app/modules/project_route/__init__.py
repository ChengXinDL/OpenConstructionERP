# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Work-type classifier gate ("delivery / permit route") module.

A small project-scoped gate that classifies a project's *work type* (new build,
reconstruction, capital repair, re-equipment, maintenance, demolition, change of
use) plus a handful of classifier answers into a *delivery / permit route*:
whether the work needs a full permit, a prior notification, proceeds as
permitted development, is exempt, or requires independent design expertise.

The classifier itself is a small, ordered decision tree expressed as **data**
(:data:`app.modules.project_route.service.DEFAULT_ROUTE_RULES`), not code, so a
regional pack can override the whole rule set without touching the engine. The
built-in set is deliberately jurisdiction-neutral - it never encodes a single
country's law. Regional packs map the generic routes onto local procedures
(RU new build / reconstruction / capital repair / re-equipment; US as-of-right
zoning; UK permitted development; etc.).

A confirmed route is a gate: the ``route_determined`` validation rule flags a
project that has not yet settled and confirmed its delivery route.
"""


async def on_startup() -> None:
    """Module startup hook - register permissions and validation rules."""
    from app.modules.project_route.permissions import register_project_route_permissions
    from app.modules.project_route.validators import register_project_route_validation_rules

    register_project_route_permissions()
    register_project_route_validation_rules()
