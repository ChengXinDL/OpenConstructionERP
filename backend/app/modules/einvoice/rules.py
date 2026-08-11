# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""EN 16931 business rules, evaluated in Python.

A receiver validates an incoming e-invoice against the EN 16931 Schematron (in
Germany, the KoSIT validator). Every finding it reports carries a rule
identifier such as ``BR-61`` or ``BR-CO-15``, and that identifier, not the
wording, is what the sender has to act on.

This module evaluates the same rules natively. Running a Schematron engine
would mean a JVM or an XSLT processor plus the rule artefacts, which the
platform's 2GB-VPS budget does not have room for; the rules themselves are
small predicates over the semantic model, so they are expressed here directly.
Each one cites the identifier a receiver would report, which keeps our finding
and theirs comparable. This is a well-cited subset, not the full artefact: it
covers the rules an invoice assembled from platform data can actually break.

Identifier namespaces used here:
    * ``BR-*`` / ``BR-CO-*``  EN 16931-1 content and calculation rules
    * ``BR-S-*``, ``BR-Z-*``, ``BR-E-*``, ``BR-AE-*``, ``BR-IC-*``,
      ``BR-G-*``, ``BR-O-*``  the per VAT-category rule families
    * ``BR-DE-*``  XRechnung (KoSIT) national rules
    * ``PEPPOL-EN16931-*``  Peppol BIS Billing 3.0 rules
    * ``OCE-*``  house advisories, warning severity, not part of any standard
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING

from app.core.money import CURRENCIES
from app.modules.einvoice.profiles import Profile, get_profile

if TYPE_CHECKING:  # pragma: no cover - annotations only, avoids an import cycle
    from app.modules.einvoice.cii import EInvoice

__all__ = [
    "FATAL",
    "WARNING",
    "RuleViolation",
    "check",
    "check_profile",
    "fatal_only",
    "money_decimals",
    "violation_ids",
]

FATAL = "fatal"
WARNING = "warning"

# EN 16931 caps document amounts at two decimals (the BR-DEC-* family), so a
# three-decimal currency such as KWD is still written with two here. Currencies
# with no minor unit (JPY, CLP, KRW, XOF, ...) must not show cents at all.
_EN16931_MAX_DECIMALS = 2

# UNTDID 4461 payment means that assert a credit transfer, which is what makes
# the payment account identifier (BT-84) mandatory under BR-61.
CREDIT_TRANSFER_CODES = frozenset({"30", "58"})

# VAT category code (BT-151/BT-118, UNTDID 5305) -> its rule family prefix.
_CATEGORY_RULE_PREFIX = {
    "S": "BR-S",  # standard rated
    "Z": "BR-Z",  # zero rated
    "E": "BR-E",  # exempt
    "AE": "BR-AE",  # reverse charge
    "K": "BR-IC",  # intra-community supply
    "G": "BR-G",  # free export
    "O": "BR-O",  # outside the scope of VAT
    "L": "BR-IG",  # Canary Islands
    "M": "BR-IP",  # Ceuta and Melilla
}

# Categories whose VAT rate must be zero, and those whose rate must be positive.
_ZERO_RATE_CATEGORIES = frozenset({"Z", "E", "AE", "K", "G", "O"})
_POSITIVE_RATE_CATEGORIES = frozenset({"S", "L", "M"})


@dataclass(frozen=True)
class RuleViolation:
    """One rule finding.

    Attributes:
        rule_id: the identifier a receiver's validator reports, e.g. ``BR-61``.
        severity: :data:`FATAL` (the document will be rejected) or
            :data:`WARNING` (it will be accepted but something is missing).
        message: what the user has to do about it, in plain language.
        term: the EN 16931 business term at fault, e.g. ``BT-84``.
    """

    rule_id: str
    severity: str
    message: str
    term: str | None = None

    def __str__(self) -> str:
        return f"{self.rule_id}: {self.message}"


def money_decimals(currency_code: str) -> int:
    """Decimal places to write for an amount in ``currency_code``.

    The currency's own minor unit, capped at the two decimals EN 16931 allows
    for document amounts. A currency with no minor unit yields ``0``, so a yen
    or peso amount is never printed with cents.

    Args:
        currency_code: ISO 4217 code, e.g. ``"EUR"`` or ``"JPY"``.

    Returns:
        Number of decimal places, between 0 and 2.
    """
    entry = CURRENCIES.get((currency_code or "").strip().upper())
    decimals = int(entry.get("decimals", _EN16931_MAX_DECIMALS)) if entry else _EN16931_MAX_DECIMALS
    return min(max(decimals, 0), _EN16931_MAX_DECIMALS)


def _quantum(currency_code: str) -> Decimal:
    return Decimal(1).scaleb(-money_decimals(currency_code))


def _round(value: Decimal, currency_code: str) -> Decimal:
    return value.quantize(_quantum(currency_code), rounding=ROUND_HALF_UP)


def violation_ids(violations: Iterable[RuleViolation]) -> set[str]:
    """The set of rule identifiers present, for assertions and de-duplication."""
    return {v.rule_id for v in violations}


def fatal_only(violations: Iterable[RuleViolation]) -> list[RuleViolation]:
    """Just the findings that would get the document rejected."""
    return [v for v in violations if v.severity == FATAL]


# ── individual rule groups ────────────────────────────────────────────────────


def _check_header(inv: EInvoice) -> list[RuleViolation]:
    """Mandatory header content (BR-2 .. BR-16)."""
    out: list[RuleViolation] = []
    if not inv.invoice_number:
        out.append(RuleViolation("BR-2", FATAL, "Give the invoice a number.", "BT-1"))
    if not inv.issue_date:
        out.append(RuleViolation("BR-3", FATAL, "Set the invoice date.", "BT-2"))
    if not inv.type_code:
        out.append(RuleViolation("BR-4", FATAL, "Set the invoice type, an invoice or a credit note.", "BT-3"))
    if not inv.currency:
        out.append(RuleViolation("BR-5", FATAL, "Set the invoice currency, for example EUR.", "BT-5"))
    if not inv.lines:
        out.append(RuleViolation("BR-16", FATAL, "Add at least one invoice line before sending.", "BG-25"))
    return out


def _check_parties(inv: EInvoice) -> list[RuleViolation]:
    """Seller and buyer identity and address (BR-6 .. BR-11, BR-CO-9, BR-CO-26)."""
    out: list[RuleViolation] = []
    if not inv.seller.name:
        out.append(RuleViolation("BR-6", FATAL, "Add the seller name in the e-invoice settings.", "BT-27"))
    if not inv.buyer.name:
        out.append(RuleViolation("BR-7", FATAL, "Add the buyer name on the invoice.", "BT-44"))
    for who, rule_id, party, term in (
        ("seller", "BR-9", inv.seller, "BT-40"),
        ("buyer", "BR-11", inv.buyer, "BT-55"),
    ):
        if not party.country_code:
            out.append(
                RuleViolation(
                    rule_id,
                    FATAL,
                    f"Add the {who} country code, two letters such as DE or FR, in the e-invoice settings.",
                    term,
                )
            )
    if not (inv.seller.vat_id or inv.seller.tax_number or inv.seller.legal_id):
        out.append(
            RuleViolation(
                "BR-CO-26",
                FATAL,
                "Add the seller VAT id (BT-31) or, if there is none, a tax number (BT-32) in the e-invoice settings.",
                "BT-31",
            )
        )
    for who, vat_id, term in (("seller", inv.seller.vat_id, "BT-31"), ("buyer", inv.buyer.vat_id, "BT-48")):
        if vat_id and not _has_country_prefix(vat_id):
            out.append(
                RuleViolation(
                    "BR-CO-9",
                    FATAL,
                    f"The {who} VAT identifier must start with its country code, for example DE{vat_id}.",
                    term,
                )
            )
    return out


def _has_country_prefix(vat_id: str) -> bool:
    """True when a VAT identifier starts with an ISO 3166-1 alpha-2 prefix."""
    cleaned = vat_id.strip().replace(" ", "")
    return len(cleaned) > 2 and cleaned[:2].isalpha()


def _check_lines(inv: EInvoice) -> list[RuleViolation]:
    """Mandatory line content (BR-21 .. BR-27)."""
    out: list[RuleViolation] = []
    for line in inv.lines:
        where = line.line_id or "?"
        if not line.line_id:
            out.append(RuleViolation("BR-21", FATAL, "Every invoice line needs a line number.", "BT-126"))
        if not line.name:
            out.append(RuleViolation("BR-25", FATAL, f"Line {where} needs an item name or description.", "BT-153"))
        if not line.unit:
            out.append(RuleViolation("BR-23", FATAL, f"Line {where} needs a unit of measure.", "BT-130"))
        if line.net_unit_price is None or line.net_unit_price < 0:
            out.append(RuleViolation("BR-27", FATAL, f"The unit price on line {where} cannot be negative.", "BT-146"))
    return out


def _check_totals(inv: EInvoice) -> list[RuleViolation]:
    """The calculation chain (BR-CO-10, BR-CO-13, BR-CO-14, BR-CO-15, BR-CO-16)."""
    out: list[RuleViolation] = []
    cur = inv.currency
    line_sum = sum((ln.line_net_amount for ln in inv.lines), Decimal("0"))
    if _round(inv.line_total, cur) != _round(line_sum, cur):
        out.append(RuleViolation("BR-CO-10", FATAL, "The invoice lines do not add up to the net total.", "BT-106"))
    if _round(inv.tax_basis_total, cur) != _round(inv.line_total, cur):
        out.append(
            RuleViolation(
                "BR-CO-13",
                FATAL,
                "The net total to be taxed must equal the sum of the invoice lines.",
                "BT-109",
            )
        )
    breakdown_tax = sum((g.tax_amount for g in inv.tax_subtotals), Decimal("0"))
    if _round(inv.tax_total, cur) != _round(breakdown_tax, cur):
        out.append(RuleViolation("BR-CO-14", FATAL, "The VAT total must equal the sum of the VAT breakdown.", "BT-110"))
    if _round(inv.grand_total, cur) != _round(inv.tax_basis_total + inv.tax_total, cur):
        out.append(RuleViolation("BR-CO-15", FATAL, "The gross total must equal the net total plus VAT.", "BT-112"))
    if _round(inv.due_payable, cur) != _round(inv.grand_total - inv.prepaid_amount, cur):
        out.append(
            RuleViolation(
                "BR-CO-16",
                FATAL,
                "The amount due must be the gross total minus anything already paid or retained.",
                "BT-115",
            )
        )
    return out


def _check_vat_breakdown(inv: EInvoice) -> list[RuleViolation]:
    """The VAT breakdown and its per-category families (BR-45 .. BR-48, BR-CO-17, BR-x-1/5/8)."""
    out: list[RuleViolation] = []
    cur = inv.currency

    for grp in inv.tax_subtotals:
        if not grp.category:
            out.append(RuleViolation("BR-47", FATAL, "Every VAT breakdown group needs a category code.", "BT-118"))
            continue
        if grp.rate is None:
            out.append(RuleViolation("BR-48", FATAL, "Every VAT breakdown group needs a VAT rate.", "BT-119"))
            continue
        expected = _round(grp.basis * grp.rate / Decimal("100"), cur)
        if _round(grp.tax_amount, cur) != expected:
            out.append(
                RuleViolation(
                    "BR-CO-17",
                    FATAL,
                    f"The VAT for the {grp.rate}% group must be {expected}, which is {grp.basis} times {grp.rate}%.",
                    "BT-117",
                )
            )

    # Per-category rate rules, on the lines.
    for line in inv.lines:
        prefix = _CATEGORY_RULE_PREFIX.get(line.vat_category)
        if prefix is None:
            out.append(
                RuleViolation(
                    "BR-CL-18",
                    FATAL,
                    f"Line {line.line_id} has VAT category {line.vat_category!r}, which is not a known code.",
                    "BT-151",
                )
            )
            continue
        if line.vat_category in _ZERO_RATE_CATEGORIES and line.vat_rate != 0:
            out.append(
                RuleViolation(
                    f"{prefix}-5",
                    FATAL,
                    f"Line {line.line_id} is VAT category {line.vat_category}, so its rate must be 0%.",
                    "BT-152",
                )
            )
        if line.vat_category in _POSITIVE_RATE_CATEGORIES and line.vat_rate <= 0:
            out.append(
                RuleViolation(
                    f"{prefix}-5",
                    FATAL,
                    f"Line {line.line_id} is standard rated, so its VAT rate must be above 0%.",
                    "BT-152",
                )
            )

    # Every category used on a line must appear in the breakdown (BR-x-1).
    breakdown_categories = {g.category for g in inv.tax_subtotals}
    for category in {ln.vat_category for ln in inv.lines}:
        prefix = _CATEGORY_RULE_PREFIX.get(category)
        if prefix and category not in breakdown_categories:
            out.append(
                RuleViolation(
                    f"{prefix}-1",
                    FATAL,
                    f"The VAT breakdown is missing a group for category {category}.",
                    "BG-23",
                )
            )

    out += _check_breakdown_basis(inv)
    return out


def _check_breakdown_basis(inv: EInvoice) -> list[RuleViolation]:
    """Each (category, rate) group's basis must equal its own lines (BR-x-8)."""
    out: list[RuleViolation] = []
    cur = inv.currency
    line_basis: dict[tuple[str, Decimal], Decimal] = {}
    for line in inv.lines:
        key = (line.vat_category, line.vat_rate)
        line_basis[key] = line_basis.get(key, Decimal("0")) + line.line_net_amount
    group_basis: dict[tuple[str, Decimal], Decimal] = {}
    for grp in inv.tax_subtotals:
        key = (grp.category, grp.rate)
        group_basis[key] = group_basis.get(key, Decimal("0")) + grp.basis

    for key in set(line_basis) | set(group_basis):
        category, rate = key
        prefix = _CATEGORY_RULE_PREFIX.get(category)
        if prefix is None:
            continue
        expected = line_basis.get(key, Decimal("0"))
        actual = group_basis.get(key, Decimal("0"))
        if _round(expected, cur) != _round(actual, cur):
            out.append(
                RuleViolation(
                    f"{prefix}-8",
                    FATAL,
                    f"The VAT group for category {category} at {rate}% says {actual} "
                    f"but its lines add up to {expected}.",
                    "BT-116",
                )
            )
    return out


def _check_payment(inv: EInvoice) -> list[RuleViolation]:
    """Payment instructions (BR-61, plus a house advisory)."""
    out: list[RuleViolation] = []
    code = (inv.payment_means_code or "").strip()
    if code in CREDIT_TRANSFER_CODES and not (inv.payee_iban or "").strip():
        out.append(
            RuleViolation(
                "BR-61",
                FATAL,
                "This invoice says it is paid by bank transfer, so it must carry the account "
                "to pay into. Add the IBAN in the e-invoice settings.",
                "BT-84",
            )
        )
    if not (inv.payee_iban or "").strip():
        out.append(
            RuleViolation(
                "OCE-PAY-01",
                WARNING,
                "No bank account is given, so the buyer cannot pay this invoice automatically. "
                "Add the IBAN in the e-invoice settings.",
                "BT-84",
            )
        )
    return out


def _check_tax_currency(inv: EInvoice) -> list[RuleViolation]:
    """BR-53: a VAT accounting currency needs its VAT total in that currency."""
    tax_currency = (inv.tax_currency or "").strip().upper()
    if not tax_currency or tax_currency == (inv.currency or "").strip().upper():
        return []
    if inv.tax_total_in_tax_currency is None:
        return [
            RuleViolation(
                "BR-53",
                FATAL,
                f"The invoice accounts for VAT in {tax_currency}, so it must also state the VAT "
                f"total in {tax_currency}.",
                "BT-111",
            )
        ]
    return []


def check_profile(inv: EInvoice, profile: Profile) -> list[RuleViolation]:
    """Rules a country or network flavour adds on top of EN 16931."""
    out: list[RuleViolation] = []
    if not profile.buyer_ref_required:
        return out
    has_buyer_ref = bool((inv.buyer_reference or "").strip())
    has_order_ref = bool((inv.order_reference or "").strip())
    if has_buyer_ref or (profile.order_ref_alternative and has_order_ref):
        return out
    label = profile.label or profile.name
    if profile.name == "xrechnung":
        out.append(
            RuleViolation(
                "BR-DE-15",
                FATAL,
                "Add the Buyer reference / Leitweg-ID (BT-10) in the e-invoice settings; XRechnung requires it.",
                "BT-10",
            )
        )
    elif profile.order_ref_alternative:
        out.append(
            RuleViolation(
                "PEPPOL-EN16931-R003",
                FATAL,
                f"Add a Buyer reference (BT-10) or an Order reference (BT-13) in the e-invoice "
                f"settings; {label} requires one of them.",
                "BT-10",
            )
        )
    else:
        out.append(
            RuleViolation(
                "BR-DE-15",
                FATAL,
                f"Add a Buyer reference (BT-10) in the e-invoice settings; {label} requires it.",
                "BT-10",
            )
        )
    return out


# ── entry point ───────────────────────────────────────────────────────────────


def check(inv: EInvoice) -> list[RuleViolation]:
    """Evaluate every rule against an invoice.

    Args:
        inv: the assembled EN 16931 invoice.

    Returns:
        Every finding, fatal and warning alike, in a stable order. An empty
        list means the invoice passes the subset implemented here.
    """
    out: list[RuleViolation] = []
    out += _check_header(inv)
    out += _check_parties(inv)
    out += _check_lines(inv)
    out += _check_totals(inv)
    out += _check_vat_breakdown(inv)
    out += _check_payment(inv)
    out += _check_tax_currency(inv)

    profile = get_profile(inv.profile)
    if profile is None:
        out.append(
            RuleViolation(
                "BR-1",
                FATAL,
                f"Unknown e-invoice format {inv.profile!r}.",
                "BT-24",
            )
        )
    else:
        out += check_profile(inv, profile)
    return out
