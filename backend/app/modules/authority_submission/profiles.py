# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Built-in, jurisdiction-neutral submission profiles (seed data).

These ship with the platform so the factory is useful out of the box without any
regional pack. They are deliberately neutral:

- ``generic_xml`` - a plain structured document, the fallback when no dialect
  applies.
- ``gaeb_x83`` - shaped after the DACH GAEB X83 tender-exchange pattern (a root
  element wrapping award info and a list of priced positions). This is the
  proven pattern the whole engine generalises; it is kept content-neutral so it
  is not tied to any one country's tender law.
- ``cobie`` - shaped after the COBie asset-handover pattern (a register of
  facilities / spaces handed to a client at closeout).

Where national dialects plug in
===============================
A regional pack registers additional profiles the same way - as rows with their
own ``field_spec`` and ``root_element``. For example an ``RU Minstroy expertise``
profile would set ``format_key="minstroy_xml"``, ``jurisdiction="RU"``, its own
``root_element`` and the Minstroy field set; a UK ``eplan`` profile would set
``format_key="eplan"``, ``jurisdiction="GB"``. Nothing in the engine is
country-specific - only these data rows are.

``field_spec`` descriptor keys
==============================
    name        - payload key (required)
    type        - string | integer | number | boolean | date | array | object
    required    - bool (default False)
    xml_tag     - element name in the output (default: name)
    label       - human label for the render view (default: humanised name)
    item_tag    - array only: element name for each item (default: "item")
    fields      - array/object only: nested field_spec for each item / the object
"""

from __future__ import annotations

from typing import Any

# Each entry is the kwargs for a SubmissionProfile row. Matched on
# (name, format_key) so re-seeding is idempotent.
BUILTIN_PROFILES: list[dict[str, Any]] = [
    {
        "name": "Generic XML document",
        "jurisdiction": None,
        "format_key": "generic_xml",
        "schema_version": "1.0",
        "root_element": "Document",
        "description": (
            "A plain structured XML document. Use when no jurisdiction-specific "
            "dialect applies, or as a starting point for a custom profile."
        ),
        "field_spec": [
            {"name": "title", "type": "string", "required": True, "xml_tag": "Title"},
            {"name": "reference", "type": "string", "required": False, "xml_tag": "Reference"},
            {"name": "date", "type": "date", "required": False, "xml_tag": "Date"},
            {"name": "author", "type": "string", "required": False, "xml_tag": "Author"},
            {"name": "body", "type": "string", "required": False, "xml_tag": "Body"},
        ],
    },
    {
        "name": "Tender exchange (GAEB X83 pattern)",
        "jurisdiction": None,
        "format_key": "gaeb_x83",
        "schema_version": "3.3",
        "root_element": "TenderExchange",
        "description": (
            "Shaped after the DACH GAEB X83 tender-award exchange: award "
            "metadata plus a list of priced positions. Content-neutral - the "
            "proven pattern the engine generalises. A national tender dialect "
            "plugs in as its own profile row."
        ),
        "field_spec": [
            {"name": "project_name", "type": "string", "required": True, "xml_tag": "ProjectName"},
            {"name": "currency", "type": "string", "required": True, "xml_tag": "Currency"},
            {"name": "award_date", "type": "date", "required": False, "xml_tag": "AwardDate"},
            {
                "name": "positions",
                "type": "array",
                "required": True,
                "xml_tag": "Positions",
                "item_tag": "Position",
                "fields": [
                    {"name": "ordinal", "type": "string", "required": True, "xml_tag": "Ordinal"},
                    {
                        "name": "description",
                        "type": "string",
                        "required": True,
                        "xml_tag": "Description",
                    },
                    {"name": "unit", "type": "string", "required": True, "xml_tag": "Unit"},
                    {"name": "quantity", "type": "number", "required": True, "xml_tag": "Quantity"},
                    {
                        "name": "unit_rate",
                        "type": "number",
                        "required": True,
                        "xml_tag": "UnitRate",
                    },
                ],
            },
            {"name": "total", "type": "number", "required": False, "xml_tag": "Total"},
        ],
    },
    {
        "name": "Asset handover (COBie pattern)",
        "jurisdiction": None,
        "format_key": "cobie",
        "schema_version": "2.4",
        "root_element": "AssetHandover",
        "description": (
            "Shaped after the COBie asset-handover pattern: facility metadata "
            "plus a register of spaces handed to the client at closeout. "
            "Content-neutral."
        ),
        "field_spec": [
            {"name": "facility_name", "type": "string", "required": True, "xml_tag": "FacilityName"},
            {"name": "site", "type": "string", "required": False, "xml_tag": "Site"},
            {
                "name": "spaces",
                "type": "array",
                "required": True,
                "xml_tag": "Spaces",
                "item_tag": "Space",
                "fields": [
                    {"name": "name", "type": "string", "required": True, "xml_tag": "Name"},
                    {"name": "category", "type": "string", "required": False, "xml_tag": "Category"},
                    {"name": "area", "type": "number", "required": False, "xml_tag": "Area"},
                ],
            },
        ],
    },
]


__all__ = ["BUILTIN_PROFILES"]
