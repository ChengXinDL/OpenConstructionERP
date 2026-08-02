# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Resolving a seed row's party must fail to nothing, never to the wrong party.

Five registers link to a contact through ``_seeded_party_id``. The PG tests
prove the links reach the database; this pins the rule that decides what happens
when they cannot, which is the part a reader is most likely to 'tidy up'.

The registers seed more rows than there are firms with a contact. Falling back
to the first contact of the role would give every one of those rows a link, and
each would be wrong: a purchase order whose note names one company while its
vendor link points at another looks correct on every screen that shows it, and
nothing downstream can tell. An empty cell is visibly empty. So an index past
the end resolves to nothing on purpose, and this file is where that is written
down as a decision rather than an oversight.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.demo_projects import _seeded_party_id, _uuid_or_none

_SEEDED = {
    "contractor": ["c-0"],
    "subcontractor": ["s-0", "s-1", "s-2"],
    "consultant": ["k-0", "k-1"],
}


@pytest.mark.parametrize(
    ("role", "index", "expected"),
    [
        ("contractor", 0, "c-0"),
        ("subcontractor", 0, "s-0"),
        ("subcontractor", 1, "s-1"),
        ("subcontractor", 2, "s-2"),
        ("consultant", 1, "k-1"),
    ],
)
def test_a_position_inside_the_role_picks_that_contact(role: str, index: int, expected: str) -> None:
    """The nth subcontract is the nth firm's, not the first firm's repeated."""
    assert _seeded_party_id(_SEEDED, role, index) == expected


@pytest.mark.parametrize("index", [3, 4, 99])
def test_a_position_past_the_end_resolves_to_nothing(index: int) -> None:
    """The decision this file exists for. A wrong link outranks a missing one in damage."""
    assert _seeded_party_id(_SEEDED, "subcontractor", index) is None


@pytest.mark.parametrize("index", [-1, -3])
def test_a_negative_position_resolves_to_nothing(index: int) -> None:
    """Python would read -1 as the last contact, which is a different firm again."""
    assert _seeded_party_id(_SEEDED, "subcontractor", index) is None


@pytest.mark.parametrize("role", ["authority", "supplier", "", None])
def test_a_role_the_demo_did_not_seed_resolves_to_nothing(role: str | None) -> None:
    """A register may name a party this demo has no contact for; that is not an error."""
    assert _seeded_party_id(_SEEDED, role) is None


def test_no_contacts_at_all_resolves_to_nothing() -> None:
    """The contacts block is fail-soft, so every caller must survive it seeding none."""
    assert _seeded_party_id({}, "contractor") is None


def test_the_id_is_returned_as_stored_for_the_text_columns() -> None:
    """Some columns take the id as text and some as a UUID; only one of them converts."""
    ids = {"contractor": [str(uuid.uuid4())]}
    resolved = _seeded_party_id(ids, "contractor")
    assert resolved == ids["contractor"][0]
    assert isinstance(resolved, str)
    assert _uuid_or_none(resolved) == uuid.UUID(ids["contractor"][0])
    assert _uuid_or_none(None) is None
