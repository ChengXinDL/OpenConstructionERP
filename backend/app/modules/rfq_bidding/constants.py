# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""The vocabulary of the RFQ register.

The models, the schemas and the pure comparison all have to agree on what an
adjustment kind or a quote status is. Keeping the words here rather than in
``models`` means the pure layers can read them without importing the ORM, and
there is one place a new value is added instead of three that drift.
"""

from __future__ import annotations

#: ``RFQ.evaluation_method`` values. ``lowest_price`` ranks on the normalised
#: amount alone; ``best_value`` blends it with the technical score using
#: ``RFQ.technical_weight``.
EVALUATION_METHODS: frozenset[str] = frozenset({"lowest_price", "best_value"})

#: ``RFQBid.status`` values. Awarding is tracked separately on ``is_awarded``,
#: because standing (may this quote be ranked at all?) and outcome (did it win?)
#: are different questions: a quote can be late and still win, once the buyer
#: has admitted it in writing.
BID_STATUS_RECEIVED = "received"
BID_STATUS_LATE = "late"
BID_STATUS_WITHDRAWN = "withdrawn"
BID_STATUS_DISQUALIFIED = "disqualified"
BID_STATUSES: frozenset[str] = frozenset(
    {
        BID_STATUS_RECEIVED,
        BID_STATUS_LATE,
        BID_STATUS_WITHDRAWN,
        BID_STATUS_DISQUALIFIED,
    }
)

#: ``RFQBidAdjustment.kind`` values. Free text would make one supplier's freight
#: and another's delivery two different things and defeat the point of
#: normalising at all.
ADJUSTMENT_KINDS: frozenset[str] = frozenset(
    {
        "freight",
        "taxes",
        "duties",
        "installation",
        "commissioning",
        "warranty",
        "site_services",
        "discount",
        "provisional_sum",
        "other",
    }
)

#: ``RFQBidAdjustment.source`` values: the supplier stated it, or the buyer
#: added an allowance to make the quote comparable with the others.
ADJUSTMENT_SOURCES: frozenset[str] = frozenset({"bidder", "buyer"})
