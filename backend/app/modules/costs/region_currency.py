# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""The one ``region -> ISO 4217`` table cost rows are written and read through.

A CWICR work-item parquet carries no currency column. Every rate in it is
denominated in the local currency of the base it belongs to, so the region tag
on the row IS the currency, and the importer resolves it once per import and
stamps it on every row it writes.

That only works if the currency table covers the same regions the importer will
accept. It did not. The set of loadable bases comes from
:mod:`app.modules.costs.base_registry` (``github_workitems_files()``), while the
currency table was built from the v3 snapshot registry plus a hand-kept alias
overlay. Twelve of the thirty-eight loadable regions were absent from it -
``ZH_SHANGHAI``, ``TR_ISTANBUL``, ``UK_GBP``, ``PT_SAOPAULO``, ``AR_DUBAI``,
``HI_MUMBAI``, ``ENG_TORONTO``, ``SP_BARCELONA``, ``CS_PRAGUE``, ``JA_TOKYO``,
``KO_SEOUL``, ``MX_MEXICOCITY`` - and an import of any of them resolved to the
empty string and wrote a whole catalogue of prices with no unit of money on
them. One such import put 55 718 rows on the floor.

So the table is built from the registry the importer itself reads, and the two
can no longer disagree: a base that can be loaded can be priced.

Layers, in the order they are applied. Later layers only fill gaps, they never
overwrite an earlier answer:

1. The v3 snapshot registry (:data:`CWICR_V3_CATALOGUES`) - the catalogue
   editions DDC publishes, each declaring its own ISO code.
2. Every loadable base in :mod:`base_registry`, taking the currency its own
   variant declares. This is the layer that was missing.
3. Legacy alias tags older parquet files still carry, which name no base of
   their own but must keep resolving for installs that hold their rows.

Measured when this module was written: layers 1 and 2 agree on every region
they both name, so the ordering between them decides nothing today. It is
declared anyway, because a v3 edition is the published artefact and should win
if the two ever drift.

A region in none of the three layers resolves to ``""``. That is deliberate and
is not a gap to be closed with a default - see
:func:`app.modules.costs.router._resolve_currency`. Labelling a Kenyan rate EUR
because EUR is a common answer corrupts every conversion downstream, while an
empty currency is honestly unknown and is rendered and skipped as such.
"""

from __future__ import annotations

# Tags that name no loadable base but appear as ``oe_costs_item.region`` on rows
# already in customer databases: older parquet ``db_id`` values, and the region
# ids of bases whose loader predates the registry. Keys follow the parquet
# convention (UPPERCASE, country prefix).
#
# ``PT_SAOPAULO`` is NOT here and does not need to be. It was once excluded from
# this overlay as a mislabel, on the reasoning that Sao Paulo is Brazil and the
# canonical key is ``BR_SAOPAULO``. Both are real: ``BR_SAOPAULO`` is a v3
# snapshot region and ``PT_SAOPAULO`` is the region id of the Brazil / Portugal
# card in the global family, which ``github_workitems_files()`` will happily
# load. Layer 2 now supplies it from the registry that ships it.
LEGACY_REGION_CURRENCY: dict[str, str] = {
    "DE_HAMBURG": "EUR",
    "BE_BRUSSELS": "EUR",
    "IE_DUBLIN": "EUR",
    "USA_NEWYORK": "USD",
    "SA_RIYADH": "SAR",
}


def build_region_currency() -> dict[str, str]:
    """Build the ``{region: ISO 4217}`` table from the three layers above."""
    # Imported inside the function so this module stays importable from both
    # the router and the response schemas without either of them pulling the
    # other in through it.
    from app.modules.costs import base_registry
    from app.modules.costs.cwicr_v3_catalogue import CWICR_V3_CATALOGUES

    out: dict[str, str] = {cat.region: cat.currency for cat in CWICR_V3_CATALOGUES if cat.currency}

    for region in base_registry.github_workitems_files():
        variant = base_registry.variant_by_region(region)
        if variant is not None and variant.currency:
            out.setdefault(region, variant.currency)

    for region, currency in LEGACY_REGION_CURRENCY.items():
        out.setdefault(region, currency)

    return out


#: The table itself. Both the write path (the importer and the cost item
#: service) and the read paths (the response schema validator, the Cost
#: Explorer) bind this same object, so a region can never resolve one way on
#: the way in and another way on the way out.
REGION_CURRENCY: dict[str, str] = build_region_currency()
