# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Contracts put up for signature: the reference, the gate and the re-hash.

Everything here needs two modules' tables at once, which is why it is in the
PostgreSQL lane rather than beside the pure-function tests.

The reference. A signing session is filed under ``contract:{id}`` and nothing
else knows how to find it. If the reference the writer builds and the reference
the reader queries ever drift apart, every screen goes quietly empty rather than
failing, so the round trip is asserted through the service rather than assumed
from the constant.

The gate. Running the compliance gate at session initiation is the point of the
whole endpoint: the same gate also guards ``draft -> active``, but by then
everyone has signed. A test that only proved the transition is gated would pass
on a version where the initiation check was deleted.

The re-hash. ``signing.delta_by_hash`` can only ever report a stale signature if
somebody pushes a new content hash when the paper changes, and the signing module
cannot do that because it has no way to look at a contract. So the duty sits on
``update_contract``, and this file is what proves the machinery can actually
fire. Delete the ``refresh_signing_content_hash`` call and only this test goes
red; every other check on both modules stays green while the staleness feature
is structurally dead.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.modules.contracts import signing_bridge
from app.modules.contracts.models import ContractParty
from app.modules.contracts.schemas import ContractCreate, ContractUpdate
from app.modules.contracts.service import ContractsService
from app.modules.projects.models import Project
from app.modules.signing.schemas import AttestationCreate
from app.modules.signing.service import SigningService
from app.modules.users.models import User


def _unique(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


async def _project(session) -> tuple[uuid.UUID, str]:
    owner = User(
        email=f"sign-{uuid.uuid4().hex[:8]}@example.test",
        hashed_password="x",
        full_name="Signing Owner",
    )
    session.add(owner)
    await session.flush()
    project = Project(name="Contract signing", owner_id=owner.id)
    session.add(project)
    await session.flush()
    return project.id, str(owner.id)


async def _contract_with_parties(session, service: ContractsService, user_id: str, project_id: uuid.UUID):
    """A draft contract with an employer and a contractor on its party register."""
    contract = await service.create_contract(
        ContractCreate(
            code=_unique("C"),
            title="Signing bridge",
            contract_type="lump_sum",
            project_id=project_id,
            total_value=Decimal("250000.00"),
            currency="EUR",
        ),
        user_id,
    )
    await session.flush()
    session.add_all(
        [
            ContractParty(
                contract_id=contract.id,
                party_role="employer",
                party_type="external",
                display_name="Northlake Estates",
                is_primary=True,
            ),
            ContractParty(
                contract_id=contract.id,
                party_role="contractor",
                party_type="external",
                display_name="Bramwell Civil Works",
            ),
        ]
    )
    await session.flush()
    return contract


# ── The reference and the derived map ─────────────────────────────────────


@pytest.mark.asyncio
async def test_a_session_is_filed_under_the_contract_and_signatories_come_from_the_parties(
    pg_session,
) -> None:
    """Opening a session and finding it again have to agree on one reference."""
    project_id, user_id = await _project(pg_session)
    service = ContractsService(pg_session)
    contract = await _contract_with_parties(pg_session, service, user_id, project_id)

    row = await service.open_signing_session(contract.id, actor_id=user_id)
    await pg_session.flush()

    assert row.document_ref == signing_bridge.contract_document_ref(contract.id)
    assert signing_bridge.parse_contract_document_ref(row.document_ref) == contract.id
    assert row.project_id == contract.project_id

    # Derived from the register, in signature-block order, both required.
    roles = [entry["role"] for entry in row.signatory_map]
    names = [entry["name"] for entry in row.signatory_map]
    assert roles == ["employer", "contractor"]
    assert names == ["Northlake Estates", "Bramwell Civil Works"]
    assert all(entry["required"] for entry in row.signatory_map)

    # The read path finds it by the same reference the write path built.
    found = await service.list_signing_sessions(contract.id)
    assert [s.id for s in found] == [row.id]


@pytest.mark.asyncio
async def test_a_contract_with_nobody_on_its_party_register_is_refused(pg_session) -> None:
    """No parties means no signatories, and a session without those is theatre.

    Every other test in this file builds a contract *with* parties, which is
    exactly how an earlier version shipped a fallback that invented one: it
    named the signatory after the contract's own title, so the register would
    have recorded that a party named "Signing bridge" executed the paper called
    "Signing bridge". Nothing in the suite touched the branch, and the screen
    showed the invented name as though it were a company.
    """
    project_id, user_id = await _project(pg_session)
    service = ContractsService(pg_session)
    contract = await service.create_contract(
        ContractCreate(
            code=_unique("C"),
            title="Signing bridge",
            contract_type="lump_sum",
            project_id=project_id,
            total_value=Decimal("250000.00"),
            currency="EUR",
        ),
        user_id,
    )
    await pg_session.flush()

    with pytest.raises(HTTPException) as excinfo:
        await service.open_signing_session(contract.id, actor_id=user_id)
    assert excinfo.value.status_code == 400
    assert "party register" in str(excinfo.value.detail)

    # And nothing was filed: a refused attempt leaves no session behind.
    assert await service.list_signing_sessions(contract.id) == []


@pytest.mark.asyncio
async def test_a_party_who_does_not_sign_does_not_make_a_contract_signable(pg_session) -> None:
    """A consultant on the register is not a signatory to the contract."""
    project_id, user_id = await _project(pg_session)
    service = ContractsService(pg_session)
    contract = await service.create_contract(
        ContractCreate(
            code=_unique("C"),
            title="Consultant only",
            contract_type="lump_sum",
            project_id=project_id,
            total_value=Decimal("10000.00"),
            currency="EUR",
        ),
        user_id,
    )
    await pg_session.flush()
    pg_session.add(
        ContractParty(
            contract_id=contract.id,
            party_role="consultant",
            party_type="external",
            display_name="Harkness Cost Consultancy",
        )
    )
    await pg_session.flush()

    with pytest.raises(HTTPException) as excinfo:
        await service.open_signing_session(contract.id, actor_id=user_id)
    assert excinfo.value.status_code == 400


@pytest.mark.asyncio
async def test_a_second_session_is_refused_while_one_is_outstanding(pg_session) -> None:
    """Two open sessions would give one contract two hashes and no tie-break."""
    project_id, user_id = await _project(pg_session)
    service = ContractsService(pg_session)
    contract = await _contract_with_parties(pg_session, service, user_id, project_id)

    await service.open_signing_session(contract.id, actor_id=user_id)
    await pg_session.flush()

    with pytest.raises(HTTPException) as excinfo:
        await service.open_signing_session(contract.id, actor_id=user_id)
    assert excinfo.value.status_code == 409


@pytest.mark.asyncio
async def test_a_contract_that_has_left_draft_cannot_be_put_up_for_signature(pg_session) -> None:
    project_id, user_id = await _project(pg_session)
    service = ContractsService(pg_session)
    contract = await _contract_with_parties(pg_session, service, user_id, project_id)

    await service.transition_contract(contract.id, "active", user_id)
    await pg_session.flush()

    with pytest.raises(HTTPException) as excinfo:
        await service.open_signing_session(contract.id, actor_id=user_id)
    assert excinfo.value.status_code == 400


# ── The re-hash ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_editing_the_contract_makes_the_signatures_collected_so_far_stale(pg_session) -> None:
    """The one check that proves delta-by-hash can fire on a contract at all.

    A signature is recorded against the session's hash, so it starts current.
    Editing the contract has to move the session's hash, and only then does the
    signing module have anything to compare against and report.
    """
    project_id, user_id = await _project(pg_session)
    service = ContractsService(pg_session)
    signing = SigningService(pg_session)
    contract = await _contract_with_parties(pg_session, service, user_id, project_id)

    row = await service.open_signing_session(contract.id, actor_id=user_id)
    await pg_session.flush()
    hash_at_issue = row.document_content_hash

    await signing.record_attestation(
        row.id,
        AttestationCreate(
            signatory_name="Northlake Estates",
            signatory_role="employer",
            content_hash=hash_at_issue,
        ),
        user_id=user_id,
    )
    await pg_session.flush()

    view = await service.signing_session_view(contract, row)
    assert view["content_hash_current"] is True
    assert view["stale_signatories"] == []
    assert view["signed_roles"] == ["employer"]

    # The paper moves. Title is not a financial field, so a draft accepts it.
    #
    # Asserted in two steps on purpose. The first says the hash function saw the
    # edit at all; the second says the session was moved onto it. Collapsing them
    # into one comparison against the stale ``row`` would blame the bridge for a
    # failure that is really about when the updated contract becomes visible to
    # the nested read, and it would do it three lines away from the cause.
    before = await service.contract_content_hash(contract)
    assert before == hash_at_issue
    await service.update_contract(contract.id, ContractUpdate(title="Signing bridge, revised scope"))
    await pg_session.flush()
    after = await service.contract_content_hash(contract)
    assert after != before
    await pg_session.refresh(row)

    assert row.document_content_hash == after
    assert row.document_content_hash != hash_at_issue
    view = await service.signing_session_view(contract, row)
    assert view["content_hash_current"] is True  # session moved with the contract
    assert view["stale_signatories"] == ["Northlake Estates"]


@pytest.mark.asyncio
async def test_a_closed_session_is_not_re_hashed_by_a_later_edit(pg_session) -> None:
    """A declined session is history and must keep the hash it was declined on."""
    project_id, user_id = await _project(pg_session)
    service = ContractsService(pg_session)
    signing = SigningService(pg_session)
    contract = await _contract_with_parties(pg_session, service, user_id, project_id)

    row = await service.open_signing_session(contract.id, actor_id=user_id)
    await pg_session.flush()
    hash_at_issue = row.document_content_hash

    from app.modules.signing.schemas import DeclineCreate

    await signing.record_decline(
        row.id,
        DeclineCreate(
            signatory_name="Bramwell Civil Works",
            signatory_role="contractor",
            reason="Programme dates not agreed.",
        ),
        user_id=user_id,
    )
    await pg_session.flush()
    assert row.status == "declined"

    moved = await service.refresh_signing_content_hash(contract.id)
    await pg_session.flush()
    assert moved == 0
    assert row.document_content_hash == hash_at_issue


# ── The outcome drives the contract ───────────────────────────────────────


@pytest.mark.asyncio
async def test_sync_holds_a_partly_signed_contract_and_activates_a_fully_signed_one(
    pg_session,
) -> None:
    project_id, user_id = await _project(pg_session)
    service = ContractsService(pg_session)
    signing = SigningService(pg_session)
    contract = await _contract_with_parties(pg_session, service, user_id, project_id)

    row = await service.open_signing_session(contract.id, actor_id=user_id)
    await pg_session.flush()

    await signing.record_attestation(
        row.id,
        AttestationCreate(
            signatory_name="Northlake Estates",
            signatory_role="employer",
            content_hash=row.document_content_hash,
        ),
        user_id=user_id,
    )
    await pg_session.flush()
    assert row.status == "partially_signed"

    held = await service.sync_contract_from_signing(contract.id, user_id)
    assert held.status == "draft"

    await signing.record_attestation(
        row.id,
        AttestationCreate(
            signatory_name="Bramwell Civil Works",
            signatory_role="contractor",
            content_hash=row.document_content_hash,
        ),
        user_id=user_id,
    )
    await pg_session.flush()
    assert row.status == "fully_signed"

    activated = await service.sync_contract_from_signing(contract.id, user_id)
    await pg_session.flush()
    assert activated.status == "active"
    # The transition stamped its own audit, so the gate really ran on the way
    # through rather than being skipped because signing had already happened.
    assert "compliance_validation" in (activated.metadata_ or {})
    assert activated.signed_at

    # Idempotent: calling again on an active contract changes nothing.
    again = await service.sync_contract_from_signing(contract.id, user_id)
    assert again.status == "active"
