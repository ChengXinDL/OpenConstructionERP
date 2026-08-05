# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Cases module.

The shipped case scenarios are source files compiled into the frontend, which
makes authoring one a build step rather than something a user can do. This
module is the other half: a team writes its own walkthrough of how work is
actually done here, optionally starting from one of the shipped playbooks, and
pins a curated set to a project.

Pinning used to live in ``localStorage``, so a curated set was per browser -
not per account, not shared with the team, and gone on another device. Here it
belongs to the user record instead.

No ``relationship()`` is declared anywhere in this module: a case owns its
steps as a JSON array and a pin points at its case by id across two id spaces,
so there is no lazy-loading strategy to choose.
"""


async def on_startup() -> None:
    """Module startup hook (called by the module loader after mount).

    Registers two things, both load-bearing:

    * the module's permissions, without which ``RequirePermission`` denies an
      unregistered key and every endpoint here is admin-only;
    * the ``cases`` validation rule set, which the create and update endpoints
      run on every save and which gates sharing a case with the team.

    Idempotent - both registries overwrite by key, so a hot reload
    re-registers cleanly.
    """
    from app.modules.cases.permissions import register_cases_permissions
    from app.modules.cases.validators import register_cases_rules

    register_cases_permissions()
    register_cases_rules()
