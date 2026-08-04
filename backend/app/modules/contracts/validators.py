# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Contracts validation rules.

Ships five first-class rules registered with the platform rule registry under
the ``contracts`` rule set, of which the first three are:

* ``ContractPartyRolesRule`` (ERROR) - a contract must name the two parties
  that execute it.
* ``ContractPerformanceBondRule`` (WARNING) - a contract whose terms require a
  performance bond should have an active security row of that type.
* ``EOTDaysRule`` (ERROR) - a decided extension-of-time claim must never grant
  more days than were claimed.

The rules run against a plain dict context (no ORM), shaped by the service /
caller as::

    {
        "contract": {"id", "status", "contract_type", "terms": {...}},
        "parties": [{"party_role", "party_type", "display_name", ...}],
        "securities": [{"security_type", "status", ...}],
        "eot_claims": [{"eot_number", "days_claimed", "days_granted", "status"}],
    }

``display_name`` is the name the party would appear under on a signature
block, which is not always the stored one: a party entered as a link to a
contact, a subcontractor or a user carries no stored name at all. The service
resolves that before it builds the context, so a rule reading the field never
has to know which of the two it got.

Keeping the rules pure and dict-driven makes them trivially unit-testable and
satisfies the platform "no module without validation rules" requirement.
"""

from __future__ import annotations

import logging
from typing import Any

from app.core.validation.engine import (
    RuleCategory,
    RuleResult,
    Severity,
    ValidationContext,
    ValidationRule,
    rule_registry,
)
from app.modules.contracts.signing_bridge import SIGNING_PARTY_ROLES

logger = logging.getLogger(__name__)

#: Rule set this module's rules register under.
CONTRACTS_RULE_SET = "contracts"

#: How many parties have to be nameable before a contract can be executed. Two,
#: because a contract is an agreement between two sides and a document only one
#: side has signed is not a contract.
#:
#: Which roles those two sides go by is deliberately *not* stated here. It is
#: :data:`~app.modules.contracts.signing_bridge.SIGNING_PARTY_ROLES`, imported
#: rather than restated, so that "this rule passed" and "there is somebody for
#: the signature block to address" are one fact rather than two lists that
#: happen to agree until one of them is edited.
REQUIRED_SIGNATORY_COUNT = 2


def _data(context: ValidationContext) -> dict[str, Any]:
    return context.data if isinstance(context.data, dict) else {}


def _contract(context: ValidationContext) -> dict[str, Any]:
    contract = _data(context).get("contract")
    return contract if isinstance(contract, dict) else {}


def _rows(context: ValidationContext, key: str) -> list[dict[str, Any]]:
    rows = _data(context).get(key, [])
    if not isinstance(rows, list):
        return []
    return [r for r in rows if isinstance(r, dict)]


def _truthy(value: Any) -> bool:
    """Coerce a JSON-ish flag (bool / "true" / 1 / "yes") to a bool."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "y", "required")
    return False


def _signing_roles(parties: list[dict[str, Any]], *, named: bool) -> set[str]:
    """Signing roles on a party register, counted the way the signature block counts them.

    ``named=True`` returns the roles a signature block could actually address;
    ``named=False`` returns every signing role present, named or not. Roles are
    a set in both cases because ``signatory_map_from_parties`` takes one party
    per role: a second row in a role already taken is dropped, so two
    contractor rows are one signatory and counting rows would overstate the
    register.
    """
    roles: set[str] = set()
    for party in parties:
        role = str(party.get("party_role", "") or "").strip()
        if role not in SIGNING_PARTY_ROLES:
            continue
        if named and not str(party.get("display_name", "") or "").strip():
            continue
        roles.add(role)
    return roles


class ContractPartyRolesRule(ValidationRule):
    """A contract must name the two parties that execute it.

    Two *distinct signing roles*, each carrying a name - not a named employer
    and a named contractor. Which two roles sign depends on the contract: a
    main contract runs employer to contractor, a subcontract runs contractor to
    subcontractor, and the same firm is the buying side of one and the selling
    side of the other. An earlier version of this rule asked for an employer
    and a contractor by name, which is true of a main contract and false of
    every subcontract in the register - the employer is not a party to those
    and deliberately does not appear on them. That rule reported the whole
    subcontract register as incomplete for a party it should never have.

    Distinct roles rather than two rows, because the signature block takes one
    party per role. Two contractor rows and nobody else produce a single
    signatory, which is a contract with itself.

    Applies at every status, including ``draft``. An earlier version applied
    only to a signed contract, on the reasoning that a draft may still be
    assembling its register - but the moment the register has to be complete
    is the moment somebody puts the contract up for signature, and that only
    ever happens on a draft. So the rule that checked the party register could
    never fire while there was still something a person could do about it, and
    the check that actually stopped the press was a hardcoded refusal in the
    service with no rule id, no suggestion and no way to see it coming.

    Reporting an incomplete register on a brand-new draft is not noise: the
    panel this feeds is a completeness traffic light, "incomplete" is the true
    answer for a contract with nobody on it, and the finding carries the
    suggestion that fixes it. Nothing blocks on the finding except the signing
    gate, which is exactly the moment it should.
    """

    rule_id = "contracts.parties_complete"
    name = "Contract names the parties that sign it"
    standard = CONTRACTS_RULE_SET
    severity = Severity.ERROR
    category = RuleCategory.COMPLETENESS
    description = "A contract must name two parties in different signing roles"

    async def validate(self, context: ValidationContext) -> list[RuleResult]:
        contract = _contract(context)
        # A context with no contract in it is not a contract with no parties.
        # The compliance gate runs the same engine over a schedule of values
        # and passes positions only, so without this guard the rule would
        # report a missing party against a payload that has no register in it.
        if not contract:
            return []
        parties = _rows(context, "parties")
        named = _signing_roles(parties, named=True)
        nameless = _signing_roles(parties, named=False) - named
        passed = len(named) >= REQUIRED_SIGNATORY_COUNT
        if passed:
            message, suggestion = "OK", None
        else:
            message = f"Contract names {len(named)} of the {REQUIRED_SIGNATORY_COUNT} parties that sign it"
            if nameless:
                # The rows are there and the signature block still cannot
                # address them, which reads on screen as a register already
                # full. Say which ones rather than asking for a party that is
                # sitting in front of the reader.
                message += f", and the register carries no name for: {', '.join(sorted(nameless))}"
                suggestion = "Name every party that signs, or link it to a company on the register"
            else:
                roles = ", ".join(SIGNING_PARTY_ROLES)
                suggestion = f"Add both sides to the contract's party register, using the roles that sign: {roles}"
        return [
            RuleResult(
                rule_id=self.rule_id,
                rule_name=self.name,
                severity=self.severity,
                category=self.category,
                passed=passed,
                message=message,
                element_ref=str(contract.get("id", "")),
                suggestion=suggestion,
            )
        ]


class ContractPerformanceBondRule(ValidationRule):
    """A contract that requires a performance bond should hold an active one."""

    rule_id = "contracts.performance_bond_active"
    name = "Required performance bond is active"
    standard = CONTRACTS_RULE_SET
    severity = Severity.WARNING
    category = RuleCategory.COMPLETENESS
    description = "A contract whose terms require a performance bond should have an active bond"

    async def validate(self, context: ValidationContext) -> list[RuleResult]:
        contract = _contract(context)
        terms = contract.get("terms") if isinstance(contract.get("terms"), dict) else {}
        securities = _rows(context, "securities")
        # "Required" is signalled either by a terms flag or by a tracked bond
        # row still sitting in the "required" state.
        flagged = _truthy(terms.get("requires_performance_bond"))
        tracked = any(
            s.get("security_type") == "performance_bond" and s.get("status") == "required" for s in securities
        )
        if not (flagged or tracked):
            return []
        has_active = any(
            s.get("security_type") == "performance_bond" and s.get("status") == "active" for s in securities
        )
        return [
            RuleResult(
                rule_id=self.rule_id,
                rule_name=self.name,
                severity=self.severity,
                category=self.category,
                passed=has_active,
                message="OK" if has_active else "Required performance bond is not active",
                element_ref=str(contract.get("id", "")),
                suggestion=(None if has_active else "Record an active performance bond security"),
            )
        ]


class EOTDaysRule(ValidationRule):
    """An EOT claim must never grant more days than were claimed."""

    rule_id = "contracts.eot_days_valid"
    name = "EOT granted days within claimed days"
    standard = CONTRACTS_RULE_SET
    severity = Severity.ERROR
    category = RuleCategory.CONSISTENCY
    description = "An extension-of-time claim cannot grant more days than were claimed"

    async def validate(self, context: ValidationContext) -> list[RuleResult]:
        results: list[RuleResult] = []
        for claim in _rows(context, "eot_claims"):
            try:
                claimed = int(claim.get("days_claimed", 0) or 0)
                granted = int(claim.get("days_granted", 0) or 0)
            except (TypeError, ValueError):
                # A non-numeric value is itself a data fault; flag it.
                claimed, granted = 0, 1
            passed = granted <= claimed
            number = claim.get("eot_number") or claim.get("id") or "claim"
            results.append(
                RuleResult(
                    rule_id=self.rule_id,
                    rule_name=self.name,
                    severity=self.severity,
                    category=self.category,
                    passed=passed,
                    message=("OK" if passed else f"EOT {number} grants {granted} day(s) but only {claimed} claimed"),
                    element_ref=str(claim.get("id", "")),
                    suggestion=None if passed else "Reduce granted days to at most the claimed days",
                )
            )
        return results


class ContractTemplatePinnedRule(ValidationRule):
    """A contract that names a clause template must pin the version it used."""

    rule_id = "contracts.template_version_pinned"
    name = "Clause template reference pins a version"
    standard = CONTRACTS_RULE_SET
    severity = Severity.ERROR
    category = RuleCategory.CONSISTENCY
    description = "A contract drawn from a clause template must record which version of it"

    async def validate(self, context: ValidationContext) -> list[RuleResult]:
        contract = _contract(context)
        code = contract.get("template_code")
        version = contract.get("template_version")
        # No template at all is a legitimate state: most contracts predate the
        # feature and plenty are written from scratch. The rule is about the
        # pair being half filled, not about having one.
        if not code and version is None:
            return []
        # Version 0 is the built-in standard forms, which carry no versions of
        # their own, so zero is a complete answer and not a missing one.
        passed = bool(code) and version is not None
        if passed:
            message = "OK"
            suggestion = None
        elif code:
            message = f"Contract names clause template '{code}' without a version"
            suggestion = "Re-resolve the template so the version it was drawn from is stored"
        else:
            message = f"Contract carries clause template version {version} with no template code"
            suggestion = "Clear the version, or record the template code it belongs to"
        return [
            RuleResult(
                rule_id=self.rule_id,
                rule_name=self.name,
                severity=self.severity,
                category=self.category,
                passed=passed,
                message=message,
                element_ref=str(contract.get("id", "")),
                suggestion=suggestion,
            )
        ]


class ContractTemplateClausesRule(ValidationRule):
    """A published clause template version must actually hold clauses."""

    rule_id = "contracts.template_has_clauses"
    name = "Published clause template is not empty"
    standard = CONTRACTS_RULE_SET
    severity = Severity.ERROR
    category = RuleCategory.COMPLETENESS
    description = "A published clause template version must hold at least one clause"

    async def validate(self, context: ValidationContext) -> list[RuleResult]:
        results: list[RuleResult] = []
        for template in _rows(context, "templates"):
            # A draft is allowed to be empty; that is what drafting is. Only a
            # published version makes a promise, because that is the one a
            # contract can name.
            if str(template.get("status", "")) != "published":
                continue
            try:
                count = int(template.get("clause_count", 0) or 0)
            except (TypeError, ValueError):
                count = 0
            passed = count > 0
            label = f"{template.get('code', 'template')} v{template.get('version', '?')}"
            results.append(
                RuleResult(
                    rule_id=self.rule_id,
                    rule_name=self.name,
                    severity=self.severity,
                    category=self.category,
                    passed=passed,
                    message=("OK" if passed else f"Published clause template {label} holds no clauses"),
                    element_ref=str(template.get("id", "")),
                    suggestion=(None if passed else "Add clauses to the template, or archive the version"),
                )
            )
        return results


def register_contracts_validation_rules() -> None:
    """Register the contracts rules with the platform rule registry."""
    rule_registry.register(ContractPartyRolesRule(), [CONTRACTS_RULE_SET])
    rule_registry.register(ContractPerformanceBondRule(), [CONTRACTS_RULE_SET])
    rule_registry.register(EOTDaysRule(), [CONTRACTS_RULE_SET])
    rule_registry.register(ContractTemplatePinnedRule(), [CONTRACTS_RULE_SET])
    rule_registry.register(ContractTemplateClausesRule(), [CONTRACTS_RULE_SET])
    logger.debug("contracts: registered 5 validation rules")
