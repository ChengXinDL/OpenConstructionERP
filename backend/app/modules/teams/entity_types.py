# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""The catalogue of record kinds a project may restrict to a team.

Why a closed list rather than a free string
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
A restriction is only enforced by a consumer that asks about the same
``entity_type`` string. A typo therefore does not fail loudly: it writes a row
that hides nothing, while the operations lead who typed it believes the record
is locked down. That is a fail-open outcome, which is the one direction an
access-control feature must never take, so the write path rejects anything
outside this catalogue with a 422 and the picker in the UI is populated from it.

Adding a kind
~~~~~~~~~~~~~
Append an :class:`VisibilityEntityType` here, give it the module that owns the
records, and adopt :func:`app.modules.teams.access.hidden_entity_ids` in that
module's list and detail reads. A kind listed here with no consumer is dead
configuration - :class:`~app.modules.teams.validators.TeamsRestrictionEnforced`
reports it as a warning rather than letting it look enforced.

``label`` is the English source string. The frontend renders
``teams.entityType.<key>`` and falls back to this label, so the catalogue stays
readable in API responses and logs without a translation round-trip.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class VisibilityEntityType:
    """One record kind that can carry a team restriction."""

    key: str
    label: str
    module: str
    #: True once a consumer actually subtracts these ids from its reads.
    #: False means the row is recorded and reported but nothing enforces it,
    #: which the UI and the validation rules both have to say out loud.
    enforced: bool = False


VISIBILITY_ENTITY_TYPES: tuple[VisibilityEntityType, ...] = (
    VisibilityEntityType("boq", "Bill of quantities", "oe_boq"),
    VisibilityEntityType("boq_section", "BOQ section", "oe_boq"),
    VisibilityEntityType("document", "Document", "oe_documents"),
    VisibilityEntityType("drawing", "Drawing", "oe_documents"),
    VisibilityEntityType("model", "BIM model", "oe_bim_hub"),
    VisibilityEntityType("cost_estimate", "Cost estimate", "oe_costs"),
    VisibilityEntityType("tender_package", "Tender package", "oe_tendering"),
    VisibilityEntityType("bid", "Bid submission", "oe_bid_management"),
    VisibilityEntityType("contract", "Contract", "oe_contracts"),
    VisibilityEntityType("variation", "Variation", "oe_variations"),
    VisibilityEntityType("change_order", "Change order", "oe_changeorders"),
    VisibilityEntityType("invoice", "Invoice", "oe_finance"),
    VisibilityEntityType("subcontractor", "Subcontractor record", "oe_subcontractors"),
    VisibilityEntityType("rfi", "Request for information", "oe_rfi"),
    VisibilityEntityType("correspondence", "Correspondence item", "oe_correspondence"),
    VisibilityEntityType("meeting", "Meeting", "oe_meetings"),
    VisibilityEntityType("risk", "Risk entry", "oe_risk"),
    VisibilityEntityType("daily_diary", "Daily diary entry", "oe_daily_diary"),
    VisibilityEntityType("punch_item", "Punch item", "oe_punchlist"),
    VisibilityEntityType("inspection", "Inspection", "oe_inspections"),
)

_BY_KEY: dict[str, VisibilityEntityType] = {et.key: et for et in VISIBILITY_ENTITY_TYPES}

VISIBILITY_ENTITY_TYPE_KEYS: frozenset[str] = frozenset(_BY_KEY)


def get_entity_type(key: str) -> VisibilityEntityType | None:
    """The catalogue entry for ``key``, or ``None`` when it is not a known kind."""
    return _BY_KEY.get(key)


def is_known_entity_type(key: str) -> bool:
    """True when ``key`` names a record kind this platform can restrict."""
    return key in _BY_KEY


def enforced_entity_type_keys() -> frozenset[str]:
    """The kinds whose owning module actually subtracts restricted ids today."""
    return frozenset(et.key for et in VISIBILITY_ENTITY_TYPES if et.enforced)
