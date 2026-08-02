# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Every seeded letter must name a party the demo actually has a contact for.

The correspondence seeds carry the counterparty as a role on the seed tuple.
The writer turns that role into a contact id, so a role with no matching
contact produces a letter linked to nobody, which is the state this change was
made to end. Three of the ten letters are with a permitting body, the notice of
commencement, its acknowledgement and the inspection report, and the generated
contact list had no authority in it at all.

The role deliberately is not read back out of the subject line. The subjects do
name the party and parsing them is the obvious shortcut, but they are English
prose written to be read on a screen and they get reworded; a parser keyed on
the word "Authority" would keep producing rows after a rewording, pointing at
the wrong contact or at none, with nothing to notice. That makes the pairing
between the two lists a thing worth asserting rather than deriving.

What this does not cover: the resolution itself lives in the seeding writer and
needs a database to reach, so the direction rule (an outgoing letter fills
to_contact_ids, an incoming one fills from_contact_id) is not exercised here.
This file checks the half reachable without one, which is that every role named
is a role the demo seeds.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.core.demo_projects import DEMO_TEMPLATES, _generate_module_data


def _generated(demo_id: str) -> dict:
    return _generate_module_data(
        DEMO_TEMPLATES[demo_id],
        project_id=uuid.uuid4(),
        owner_id=uuid.uuid4(),
        demo_id=demo_id,
        base=datetime(2026, 1, 15, tzinfo=UTC),
    )


def _letters_linked_to_nobody(letters: list[dict], seeded_roles: set[str]) -> list[str]:
    """References of the letters whose party the demo seeds no contact for.

    Both tests below go through here, so the failing case exercises the same
    code the passing case does rather than a restatement of it.
    """
    return [
        letter["reference_number"]
        for letter in letters
        if not letter.get("party") or letter["party"] not in seeded_roles
    ]


@pytest.mark.parametrize("demo_id", sorted(DEMO_TEMPLATES))
def test_every_letter_is_with_a_party_the_demo_seeds(demo_id: str) -> None:
    data = _generated(demo_id)
    letters = data.get("correspondence", [])
    assert letters, f"{demo_id} generated no correspondence at all"

    seeded_roles = {c["contact_type"] for c in data.get("contacts", [])}
    unlinked = _letters_linked_to_nobody(letters, seeded_roles)
    assert not unlinked, (
        f"{demo_id} seeds {len(unlinked)} letters with a party it has no contact for: "
        f"{unlinked}; it seeds {sorted(seeded_roles)}"
    )


@pytest.mark.parametrize("demo_id", sorted(DEMO_TEMPLATES))
def test_the_permitting_body_letters_have_something_to_point_at(demo_id: str) -> None:
    """The same check narrowed onto the case that was actually broken.

    A regression here names the authority rather than only failing somewhere in
    the loop above, which is the difference between a report you can act on and
    one you have to go and read the seed list to understand.
    """
    data = _generated(demo_id)
    letters = [c for c in data.get("correspondence", []) if c.get("party") == "authority"]
    assert letters, f"{demo_id} seeds no authority correspondence"

    roles = {c["contact_type"] for c in data.get("contacts", [])}
    assert "authority" in roles, (
        f"{demo_id} writes {len(letters)} letters to or from a permitting body and seeds no authority contact for them"
    )


def test_the_check_above_reports_a_party_with_no_contact() -> None:
    """Without this the file could pass by asserting nothing."""
    seeded_roles = {"client", "consultant", "authority", "subcontractor"}
    planted = [
        {"reference_number": "OUT-2026-900", "party": "insurer"},
        {"reference_number": "IN-2026-901", "party": None},
        {"reference_number": "OUT-2026-902", "party": "client"},
    ]
    assert _letters_linked_to_nobody(planted, seeded_roles) == [
        "OUT-2026-900",
        "IN-2026-901",
    ]
