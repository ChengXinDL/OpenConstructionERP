# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Retrieval module.

Claim-grade search across the project record, plus the saved searches that turn
a one-off query into something the team can come back to.
"""


async def on_startup() -> None:
    """Module startup hook (called by the module loader after mount).

    Registers the module's validation rules into the core rule registry under
    the ``retrieval_saved_search`` rule set, which is the set
    :class:`app.modules.retrieval.service.SavedSearchService` passes to the
    engine on every write. Without this call the set resolves to nothing and
    every save would report a clean result having checked nothing at all.
    Idempotent - the registry overwrites a rule by id, so a hot reload
    re-registers cleanly.
    """
    from app.modules.retrieval.validators import register_retrieval_rules

    register_retrieval_rules()
