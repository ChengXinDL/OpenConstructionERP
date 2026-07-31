# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Pure (DB-free) helpers for saved searches.

A saved search is nothing but the six facets the ``/search`` endpoint accepts,
kept under a human label so the estimator can re-run it. Everything that
decides *whether two saves are the same search*, *whether a search is worth
saving at all* and *how a search reads back as a sentence* is here rather than
in the service, so it can be unit-tested without a database and so the rules in
:mod:`app.modules.retrieval.validators` and the repository agree by
construction instead of by review.

The signature is the piece that matters. The browser used to de-duplicate saved
searches by ``JSON.stringify`` over the trimmed facets
(``features/retrieval/savedSearches.ts::querySignature``); this module keeps the
same idea but hashes a canonical form so the value fits a fixed-width indexed
column and cannot drift with key order.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

#: The facet fields a saved search is made of, in canonical order. The names
#: match the ``/search`` query parameters and the frontend ``RetrievalQuery``
#: one for one, so a saved row can be replayed by handing it straight back.
FACET_FIELDS: tuple[str, ...] = (
    "text",
    "party",
    "record_type",
    "date_from",
    "date_to",
    "entity",
)

#: Record types :meth:`RetrievalService.gather` actually indexes. A saved search
#: pinned to anything else can only ever return nothing, which is what the
#: ``known_record_type`` validation rule reports.
INDEXED_RECORD_TYPES: tuple[str, ...] = ("document", "correspondence", "change_order")

#: ISO calendar date, the only date form the facet engine compares.
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def normalize_facets(raw: dict[str, Any] | None) -> dict[str, str]:
    """Trim a facet mapping down to the six known fields as clean strings.

    Unknown keys are dropped and every value is coerced to a stripped string,
    so a saved search never carries anything the search endpoint would ignore.
    """
    source = raw or {}
    out: dict[str, str] = {}
    for field in FACET_FIELDS:
        value = source.get(field)
        out[field] = "" if value is None else str(value).strip()
    return out


def is_meaningful(facets: dict[str, str]) -> bool:
    """True when at least one facet is set.

    An all-empty search means "everything, newest first". That is a useful
    thing to *run* and a useless thing to *save*: every empty save collides
    with every other one, and the label would be the only difference.
    """
    return any(facets.get(field, "") for field in FACET_FIELDS)


def facet_signature(facets: dict[str, str]) -> str:
    """A stable 64-char signature for a set of facets.

    Canonical order plus a unit separator that cannot occur in a trimmed facet
    value, hashed so the result fits an indexed fixed-width column. Two saves
    of the same search produce the same signature regardless of how the caller
    ordered the keys, which is what the unique constraint turns into "re-saving
    updates the existing row" instead of "the list fills with duplicates".
    """
    canonical = "\x1f".join(f"{field}={facets.get(field, '')}" for field in FACET_FIELDS)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def is_iso_date(value: str) -> bool:
    """True when ``value`` is an ISO calendar date (or empty, meaning unset)."""
    if not value:
        return True
    return bool(_ISO_DATE.match(value))


def date_window_ordered(date_from: str, date_to: str) -> bool:
    """True unless both bounds are present and ``date_from`` is after ``date_to``.

    Compared as strings, which is chronological for ISO dates. A window with a
    single bound is open-ended and always ordered.
    """
    if not date_from or not date_to:
        return True
    return date_from <= date_to


def describe_facets(facets: dict[str, str]) -> str:
    """A short English description of a search, used when no label is given.

    Mirrors ``describeQuery`` in ``features/retrieval/RetrievalPage.tsx``: the
    search text if there is one, otherwise the active facets joined up. This is
    a fallback for API callers that omit a label; the UI supplies its own
    translated label and that one wins.
    """
    text = facets.get("text", "")
    if text:
        return text
    parts: list[str] = []
    record_type = facets.get("record_type", "")
    if record_type:
        parts.append(record_type.replace("_", " "))
    party = facets.get("party", "")
    if party:
        parts.append(f"party {party}")
    entity = facets.get("entity", "")
    if entity:
        parts.append(f"reference {entity}")
    date_from = facets.get("date_from", "")
    if date_from:
        parts.append(f"from {date_from}")
    date_to = facets.get("date_to", "")
    if date_to:
        parts.append(f"to {date_to}")
    return ", ".join(parts) if parts else "All records"


__all__ = [
    "FACET_FIELDS",
    "INDEXED_RECORD_TYPES",
    "date_window_ordered",
    "describe_facets",
    "facet_signature",
    "is_iso_date",
    "is_meaningful",
    "normalize_facets",
]
