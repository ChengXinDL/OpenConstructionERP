# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Formwork module - temporary mould catalogue, priced assignments, pour cycles.

Three core entities:

* :class:`FormworkSystem` - catalogue of physical formwork systems (framed
  steel panels, aluminium slab tables, plywood and studs, climbing systems)
  with material, supplier, reuse cap, panel rate, erect/strike rate and
  striking time.
* :class:`FormworkAssignment` - links a project (and optionally a BOQ
  position) to a system with an area, an expected reuse count and a waste
  percentage. The server recomputes the rate build-up on every write to the
  assignment AND on every write to the catalogue row behind it, so a stored
  total never disagrees with the catalogue it came from.
* :class:`FormworkScheduleLine` - the pour-by-pour cycle under an assignment.
  Not decoration: the largest single pour sizes the panel set that has to be
  bought, and the total pour area divided by that set is the reuse count the
  rate may honestly be amortised over.

Validation is part of the workflow, not an add-on: eleven rules register under
the ``formwork`` rule set (see :mod:`app.modules.formwork.validators`) and are
reachable per assignment and per project.
"""


async def on_startup() -> None:
    """Module startup hook (called by the module loader after mount).

    Registers the module's validation rules into the core rule registry under
    the ``formwork`` rule set. The rules also register at import time, because
    the loader imports ``validators`` directly and a deployment that reaches
    the module by only one of those two routes must still get the rules.
    Idempotent either way - the registry overwrites a rule by id.
    """
    from app.modules.formwork.validators import register_formwork_rules

    register_formwork_rules()
