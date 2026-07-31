# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Cost-match module - matching a foreign bill onto a cost base.

The problem it solves: a quantity surveyor receives a few hundred free-text
material and work descriptions from a subcontractor, often in another language
and another unit system, and has to find the unit rate for each of them. Doing
it by hand is a day's work per bill and the mistakes it produces (an area rate
bought against a volume, the same scope priced two different ways) are
expensive and quiet.

Three entities:

* :class:`~app.modules.cost_match.models.MatchRun` - one submitted batch,
  pinned to the cost base it was priced against.
* :class:`~app.modules.cost_match.models.MatchResult` - one source line, the
  suggestion it drew, the evidence behind that suggestion (confidence,
  factors, reason codes, runners-up) and the tier it landed in.
* :class:`~app.modules.cost_match.models.MatchDecision` - one person's ruling
  on one result, append-only, carrying the reviewer and the confidence the
  machine was showing at the time.

Three tiers, one rule
---------------------
``exact`` (word-for-word after normalisation), ``high_confidence`` and
``needs_review`` order the reviewer's attention; anything below the matcher's
review floor is ``unmatched`` and keeps only the closest candidate for
context. The tier decides presentation, never adoption: no result is applied
until a person confirms, overrides or rejects it, which is platform rule 7 and
is enforced as a validation rule rather than left as an intention.

The scoring itself lives in :mod:`app.modules.cost_match.matcher`, which is
pure, database-free and international: it folds accents, normalises units
across metric and imperial by physical dimension, maps a curated multilingual
synonym set onto shared concept tokens, decomposes closed compounds, and
returns a confidence with reason codes rather than an opaque number.
Retrieval - deciding which cost items are worth scoring at all - lives in
:mod:`app.modules.cost_match.repository` and reuses the platform's shared
multilingual SQL predicate so a Spanish line can still reach a German base row.

Validation is part of the workflow, not an add-on: eleven rules register under
the ``cost_match`` rule set (see :mod:`app.modules.cost_match.validators`) and
are reachable per result and per run.
"""


async def on_startup() -> None:
    """Module startup hook (called by the module loader after mount).

    Registers the module's validation rules into the core rule registry under
    the ``cost_match`` rule set. The rules also register at import time,
    because the loader imports ``validators`` directly and a deployment that
    reaches the module by only one of those two routes must still get the
    rules. Idempotent either way - the registry overwrites a rule by id.
    """
    from app.modules.cost_match.validators import register_cost_match_rules

    register_cost_match_rules()
