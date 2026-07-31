# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Team Visibility module.

Groups the people on a project into teams, and lets a project owner narrow an
individual record down to the teams that should see it. A restriction only ever
subtracts: a record with no restriction follows plain project access, and no
arrangement of teams can show anyone a project or a record they could not
already reach. See :mod:`app.modules.teams.access` for the resolver other
modules consume.
"""


async def on_startup() -> None:
    """Module startup hook (called by the module loader after mount).

    Registers the module's validation rules into the core rule registry under
    the ``teams`` rule set, so a project's access configuration can be checked
    for the failure modes that are otherwise invisible until someone cannot
    open a record. Idempotent - the registry overwrites a rule by id, so a hot
    reload re-registers cleanly.
    """
    from app.modules.teams.validators import register_teams_rules

    register_teams_rules()
