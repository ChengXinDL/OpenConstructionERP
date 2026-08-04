# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Pure glue between a contract and the e-signature registry.

The signing module is deliberately subject-neutral: it knows a ``document_ref``
and a ``document_content_hash`` and nothing about what was signed. Everything
that turns a contract into those two strings lives here, in functions that take
plain rows and return plain values, so the whole bridge is testable without a
session and without the signing module being installed at all.

Why the content hash is computed here and not in ``signing``
===========================================================
``delta_by_hash`` in ``signing.service`` answers "whose signature went stale
because the paper moved on". It compares each attestation's ``content_hash``
against the session's current ``document_content_hash``, so it can only ever
fire if somebody recomputes and pushes that hash when the paper changes. The
signing module cannot do that: it has no way to look at a contract. So the
recompute is a contract-side duty, and ``ContractsService.update_contract``
discharges it. Without that call the staleness machinery reads as working while
being structurally unable to fire, which is worse than not having it.

What the hash covers, and why that exact set
============================================
The legally material body of the contract: its identity, its parties, its money,
its dates, its retention terms and the template version it was drawn from.
Deliberately excluded are ``status``, ``signed_at``, ``metadata_`` and the
timestamps: those move *because* of signing, and folding them in would make
every signature stale the moment the next one is recorded.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from decimal import Decimal
from typing import Any

#: ``document_ref`` namespace for a contract. The signing register is shared by
#: every module that puts paper up for signature, so the reference has to say
#: which register a row belongs to as well as which row.
CONTRACT_REF_PREFIX = "contract:"

#: Party roles that are asked to sign, in the order a signature block reads.
#: A contract can carry consultants, guarantors and observers as parties; those
#: are on the register because somebody has to be able to look them up, not
#: because they execute the document.
SIGNING_PARTY_ROLES: tuple[str, ...] = ("employer", "client", "contractor", "subcontractor")


def contract_document_ref(contract_id: uuid.UUID | str) -> str:
    """The ``document_ref`` a contract's signing sessions are filed under."""
    return f"{CONTRACT_REF_PREFIX}{contract_id}"


def parse_contract_document_ref(ref: str | None) -> uuid.UUID | None:
    """Recover the contract id from a ``document_ref``, or ``None``.

    Returns ``None`` for a reference belonging to another register and for one
    that carries our prefix but not a parsable id, so a caller can filter a
    mixed list of sessions without guarding every entry itself.
    """
    if not ref or not ref.startswith(CONTRACT_REF_PREFIX):
        return None
    try:
        return uuid.UUID(ref[len(CONTRACT_REF_PREFIX) :])
    except ValueError:
        return None


def _money(value: Any) -> str:
    """Normalise a money field to a stable string.

    ``Decimal("100")`` and ``Decimal("100.00")`` are the same amount and must
    not hash differently, so the exponent is normalised away first.
    """
    if value is None:
        return ""
    if isinstance(value, Decimal):
        normalised = value.normalize()
        # normalize() renders large round numbers in exponent form (1E+3);
        # quantize back so the string is the amount a person would read.
        if normalised == normalised.to_integral_value():
            normalised = normalised.quantize(Decimal(1))
        return format(normalised, "f")
    return str(value)


def contract_content_hash(contract: Any, parties: list[Any] | None = None) -> str:
    """SHA-256 over the legally material body of a contract.

    ``parties`` is the structured party register. It is part of the hash because
    a contract executed by one contractor is not the same paper once that
    contractor is replaced, even when every other field is untouched. Pass the
    rows the caller already loaded; an empty list means the contract has no
    structured parties, which hashes differently from not having asked.
    """
    body: dict[str, Any] = {
        "code": contract.code or "",
        "title": contract.title or "",
        "contract_type": contract.contract_type or "",
        "counterparty_type": contract.counterparty_type or "",
        "counterparty_id": str(contract.counterparty_id) if contract.counterparty_id else "",
        "project_id": str(contract.project_id),
        "parent_contract_id": (str(contract.parent_contract_id) if contract.parent_contract_id else ""),
        "start_date": contract.start_date or "",
        "end_date": contract.end_date or "",
        "total_value": _money(contract.total_value),
        "currency": contract.currency or "",
        "retention_percent": _money(contract.retention_percent),
        "retention_release_event": contract.retention_release_event or "",
        "template_code": contract.template_code or "",
        "template_version": contract.template_version,
        "terms": contract.terms or {},
        "parties": sorted(
            (
                {
                    "role": (p.party_role or ""),
                    "name": (p.display_name or ""),
                    "party_id": str(p.party_id) if p.party_id else "",
                }
                for p in (parties or [])
            ),
            key=lambda entry: (entry["role"], entry["name"], entry["party_id"]),
        ),
    }
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def signatory_map_from_parties(contract: Any, parties: list[Any] | None = None) -> list[dict[str, Any]]:
    """Derive the expected signatories from the contract's party register.

    Only the roles in :data:`SIGNING_PARTY_ROLES` are asked to sign, and every
    one of them is required: a construction contract that one side has not
    executed is not executed. Roles are unique in the map (the signing schema
    enforces that), so a second party in an already-taken role is dropped rather
    than silently overwriting the first.

    Falls back to the legacy single ``counterparty_*`` pair when the structured
    register holds nobody who signs, because contracts created before the party
    register existed still have to be signable.
    """
    entries: list[dict[str, Any]] = []
    seen: set[str] = set()
    for party in parties or []:
        role = (party.party_role or "").strip()
        if role not in SIGNING_PARTY_ROLES or role in seen:
            continue
        name = (party.display_name or "").strip()
        if not name:
            continue
        seen.add(role)
        entries.append({"name": name, "role": role, "required": True})

    if not entries:
        fallback = (contract.counterparty_type or "counterparty").strip() or "counterparty"
        entries.append(
            {
                "name": (contract.title or contract.code or "Counterparty").strip(),
                "role": fallback,
                "required": True,
            }
        )
    entries.sort(
        key=lambda entry: (
            SIGNING_PARTY_ROLES.index(entry["role"])
            if entry["role"] in SIGNING_PARTY_ROLES
            else len(SIGNING_PARTY_ROLES)
        )
    )
    return entries
