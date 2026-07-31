# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Saved Views module.

A record-level, no-code saved-search engine. A user saves a named filter spec
against any entity a module has registered as searchable, then runs it as a
paginated list, a count for a reminder badge, a dashboard tile, or an export. The
engine compiles every saved spec into one parameterized SQLAlchemy ``select()``
bounded, without exception, by three server-side gates: the scoper (which rows
you may see), the column whitelist (which columns exist), and the result budget
(how much work the query may do).
"""


async def on_startup() -> None:
    """Module startup hook - permissions, built-in entities, validation rules."""
    from app.modules.saved_views.entities import register_builtin_entities
    from app.modules.saved_views.permissions import register_saved_views_permissions
    from app.modules.saved_views.validators import register_saved_views_rules

    register_saved_views_permissions()
    register_builtin_entities()
    # The validators module also registers at import, but the platform has two
    # registration routes and a rule that only takes one of them is dormant in
    # the other deployment.
    register_saved_views_rules()
