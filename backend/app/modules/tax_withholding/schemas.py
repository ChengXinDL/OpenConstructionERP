# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Tax withholding Pydantic schemas - request/response models.

Money is :class:`~decimal.Decimal` end to end and leaves as a decimal *string*
in JSON. A float would be a rounding error on a figure that is filed with a tax
authority, and the number is not the product's to round: a deduction reported
one cent light is a return that does not reconcile.

Currency is required on every money-carrying request. These schemes exist
because work crosses a border, so a bare amount with an implied currency is
not a shortcut, it is a defect waiting for the first payment in the other one.

``taxable_base`` and ``tax_withheld`` are optional on a deduction request. Left
out, the service computes them from the regime's own rules and they are right
by construction. Supplied, they are stored as given and the validation rules
check them - which is what makes the rules meaningful for figures that arrive
from an import or from a system of record rather than from this API.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator


# Mirrors backend/app/modules/boq/schemas.py::_serialise_money - money fields
# are stored and accepted as ``Decimal`` but emitted as plain decimal strings
# in JSON so totals stay exact and locale-neutral.
def _serialise_money(value: Decimal | None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, Decimal):
        try:
            value = Decimal(str(value))
        except (InvalidOperation, ValueError):
            return "0"
    if not value.is_finite():
        return "0"
    return format(value, "f")


DeductionStatusLiteral = Literal["draft", "calculated", "remitted", "returned", "void"]
PartyStatusLiteral = Literal["pending", "active", "expired", "revoked"]
ReverseChargeStatusLiteral = Literal["draft", "applied", "superseded"]
PartyTypeLiteral = Literal["subcontractor", "vendor", "contact", "employee_of_record"]

MAX_BANDS = 12


class RateBand(BaseModel):
    """One rate band of a scheme.

    ``requires_verification`` is the load-bearing field. A band carrying it can
    only be used by a party holding an unexpired verification, which is what
    stops a lapsed certificate quietly keeping a reduced rate alive.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    code: str = Field(min_length=1, max_length=32)
    label: str = Field(default="", max_length=160)
    rate_pct: Decimal = Field(ge=Decimal("0"), le=Decimal("100"))
    requires_verification: bool = False

    @field_serializer("rate_pct", when_used="json")
    def _ser_rate(self, value: Decimal) -> str | None:
        return _serialise_money(value)


# ── Regimes ──────────────────────────────────────────────────────────────────


class _RegimeBody(BaseModel):
    """The writable half of a scheme, shared by create and update."""

    model_config = ConfigDict(str_strip_whitespace=True)

    country_code: str = Field(min_length=2, max_length=2)
    scheme_code: str = Field(min_length=1, max_length=48)
    scheme_name: str = Field(min_length=1, max_length=160)
    legal_reference: str = Field(default="", max_length=200)
    authority: str = Field(default="", max_length=160)
    currency_code: str = Field(min_length=3, max_length=3)
    bands: list[RateBand] = Field(default_factory=list, max_length=MAX_BANDS)
    default_band_code: str = Field(default="", max_length=32)
    materials_excluded: bool = True
    vat_excluded: bool = True
    verification_validity_months: int = Field(default=0, ge=0, le=600)
    threshold_amount: Decimal | None = Field(default=None, ge=Decimal("0"))
    notes: str = Field(default="", max_length=2000)
    is_active: bool = True

    @field_validator("country_code")
    @classmethod
    def _upper_country(cls, value: str) -> str:
        return value.upper()

    @field_validator("currency_code")
    @classmethod
    def _upper_currency(cls, value: str) -> str:
        return value.upper()

    @field_serializer("threshold_amount", when_used="json")
    def _ser_threshold(self, value: Decimal | None) -> str | None:
        return _serialise_money(value)


class RegimeCreateRequest(_RegimeBody):
    """Register a withholding scheme."""


class RegimeUpdateRequest(_RegimeBody):
    """Replace a withholding scheme. Schemes are edited whole."""


class RegimeResponse(BaseModel):
    """One scheme as the reader receives it."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    country_code: str
    scheme_code: str
    scheme_name: str
    legal_reference: str
    authority: str
    currency_code: str
    bands: list[RateBand]
    default_band_code: str
    materials_excluded: bool
    vat_excluded: bool
    verification_validity_months: int
    threshold_amount: Decimal | None
    notes: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    @field_serializer("threshold_amount", when_used="json")
    def _ser_threshold(self, value: Decimal | None) -> str | None:
        return _serialise_money(value)


class RegimeSeedResponse(BaseModel):
    """What installing the shipped schemes did."""

    created: int
    existing: int
    schemes: list[str] = Field(default_factory=list)


# ── Party tax status ─────────────────────────────────────────────────────────


class _PartyStatusBody(BaseModel):
    """The writable half of a party's standing under a scheme."""

    model_config = ConfigDict(str_strip_whitespace=True)

    party_id: UUID
    party_type: PartyTypeLiteral = "subcontractor"
    party_name: str = Field(default="", max_length=200)
    regime_id: UUID
    band_code: str = Field(min_length=1, max_length=32)
    verification_reference: str = Field(default="", max_length=64)
    verified_on: date | None = None
    valid_from: date
    valid_to: date | None = None
    evidence_document_id: UUID | None = None
    evidence_reference: str = Field(default="", max_length=255)
    status: PartyStatusLiteral = "pending"
    notes: str = Field(default="", max_length=2000)


class PartyStatusCreateRequest(_PartyStatusBody):
    """Record what a party's standing is under a scheme."""


class PartyStatusUpdateRequest(_PartyStatusBody):
    """Replace a party's standing. A renewal is a new window, so a full PUT."""


class PartyStatusResponse(BaseModel):
    """One party's standing, plus what today makes of it."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    party_id: UUID
    party_type: str
    party_name: str
    regime_id: UUID
    band_code: str
    verification_reference: str
    verified_on: date | None
    valid_from: date
    valid_to: date | None
    evidence_document_id: UUID | None
    evidence_reference: str
    status: str
    notes: str
    created_at: datetime
    updated_at: datetime
    # Computed by the router against the date of the request, never stored: a
    # stored "expired" flag is only as fresh as the last job that wrote it, and
    # the whole failure mode here is an expiry nobody noticed.
    is_expired: bool = False
    days_to_expiry: int | None = None


# ── Deductions ───────────────────────────────────────────────────────────────


class DeductionPreviewRequest(BaseModel):
    """Work out a deduction without storing anything.

    This is the screen that answers "what do I actually pay them", and it is
    separate from creating the record because the answer is wanted before the
    payment is agreed, not after.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    regime_id: UUID
    gross_amount: Decimal = Field(ge=Decimal("0"))
    qualifying_materials: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    vat_amount: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    currency_code: str = Field(min_length=3, max_length=3)
    band_code: str = Field(default="", max_length=32)
    party_status_id: UUID | None = None
    # The date the standing is judged against. Defaults to today in the
    # service; supplied explicitly when pricing a payment run dated forward.
    as_of: date | None = None

    @field_validator("currency_code")
    @classmethod
    def _upper_currency(cls, value: str) -> str:
        return value.upper()


class DeductionPreviewResponse(BaseModel):
    """The computed deduction, and why it came out that way."""

    regime_id: UUID
    scheme_code: str
    band_code: str
    rate_pct: Decimal
    gross_amount: Decimal
    qualifying_materials: Decimal
    vat_amount: Decimal
    taxable_base: Decimal
    tax_withheld: Decimal
    net_payable: Decimal
    currency_code: str
    below_threshold: bool = False
    # Set when the band asked for could not be used - an expired or missing
    # verification drops the party to the scheme's default band, and saying so
    # is the difference between a surprise and a decision.
    band_downgraded_from: str = ""
    reasons: list[str] = Field(default_factory=list)

    @field_serializer(
        "rate_pct",
        "gross_amount",
        "qualifying_materials",
        "vat_amount",
        "taxable_base",
        "tax_withheld",
        "net_payable",
        when_used="json",
    )
    def _ser_money(self, value: Decimal) -> str | None:
        return _serialise_money(value)


class _DeductionBody(BaseModel):
    """The writable half of a deduction, shared by create and update."""

    model_config = ConfigDict(str_strip_whitespace=True)

    project_id: UUID
    regime_id: UUID
    party_status_id: UUID | None = None
    party_id: UUID | None = None
    party_name: str = Field(default="", max_length=200)
    payment_reference: str = Field(default="", max_length=128)
    period_start: date
    period_end: date
    gross_amount: Decimal = Field(ge=Decimal("0"))
    qualifying_materials: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    vat_amount: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    # Omit both and the service computes them from the regime. Supply them and
    # they are stored as given - which is the case the validation rules exist
    # for, because an imported figure has already been decided elsewhere.
    taxable_base: Decimal | None = Field(default=None, ge=Decimal("0"))
    tax_withheld: Decimal | None = Field(default=None, ge=Decimal("0"))
    rate_pct: Decimal | None = Field(default=None, ge=Decimal("0"), le=Decimal("100"))
    band_code: str = Field(default="", max_length=32)
    currency_code: str = Field(min_length=3, max_length=3)
    status: DeductionStatusLiteral = "draft"
    remitted_at: date | None = None
    return_reference: str = Field(default="", max_length=128)
    notes: str = Field(default="", max_length=2000)

    @field_validator("currency_code")
    @classmethod
    def _upper_currency(cls, value: str) -> str:
        return value.upper()


class DeductionCreateRequest(_DeductionBody):
    """Record tax withheld from one payment."""


class DeductionUpdateRequest(_DeductionBody):
    """Replace a deduction."""


class DeductionResponse(BaseModel):
    """One deduction as the reader receives it."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    regime_id: UUID
    party_status_id: UUID | None
    party_id: UUID | None
    party_name: str
    payment_reference: str
    period_start: date
    period_end: date
    gross_amount: Decimal
    qualifying_materials: Decimal
    vat_amount: Decimal
    taxable_base: Decimal
    rate_pct: Decimal
    band_code: str
    tax_withheld: Decimal
    net_payable: Decimal
    currency_code: str
    status: str
    remitted_at: date | None
    return_reference: str
    notes: str
    created_at: datetime
    updated_at: datetime

    @field_serializer(
        "gross_amount",
        "qualifying_materials",
        "vat_amount",
        "taxable_base",
        "rate_pct",
        "tax_withheld",
        "net_payable",
        when_used="json",
    )
    def _ser_money(self, value: Decimal) -> str | None:
        return _serialise_money(value)


# ── Reverse charge ───────────────────────────────────────────────────────────


class ReverseChargeRuleResponse(BaseModel):
    """One shipped reverse-charge rule: the wording and the statute to quote."""

    rule_code: str
    country_code: str
    name: str
    legal_reference: str
    invoice_wording: str
    notes: str = ""


class _ReverseChargeBody(BaseModel):
    """The writable half of a reverse-charge determination."""

    model_config = ConfigDict(str_strip_whitespace=True)

    project_id: UUID
    invoice_id: UUID | None = None
    invoice_reference: str = Field(min_length=1, max_length=128)
    country_code: str = Field(min_length=2, max_length=2)
    # Naming a shipped rule fills the legal reference and the wording from the
    # catalogue, so the sentence on the invoice is not retyped per invoice.
    rule_code: str = Field(default="", max_length=48)
    buyer_accounts_for_vat: bool = False
    legal_reference: str = Field(default="", max_length=200)
    invoice_wording: str = Field(default="", max_length=1000)
    net_amount: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    vat_amount: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    currency_code: str = Field(min_length=3, max_length=3)
    status: ReverseChargeStatusLiteral = "draft"
    notes: str = Field(default="", max_length=2000)

    @field_validator("country_code")
    @classmethod
    def _upper_country(cls, value: str) -> str:
        return value.upper()

    @field_validator("currency_code")
    @classmethod
    def _upper_currency(cls, value: str) -> str:
        return value.upper()


class ReverseChargeCreateRequest(_ReverseChargeBody):
    """Decide who accounts for the VAT on one invoice."""


class ReverseChargeUpdateRequest(_ReverseChargeBody):
    """Replace a determination."""


class ReverseChargeResponse(BaseModel):
    """One determination as the reader receives it."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    invoice_id: UUID | None
    invoice_reference: str
    country_code: str
    rule_code: str
    buyer_accounts_for_vat: bool
    legal_reference: str
    invoice_wording: str
    net_amount: Decimal
    vat_amount: Decimal
    currency_code: str
    status: str
    notes: str
    created_at: datetime
    updated_at: datetime

    @field_serializer("net_amount", "vat_amount", when_used="json")
    def _ser_money(self, value: Decimal) -> str | None:
        return _serialise_money(value)


# ── Findings ─────────────────────────────────────────────────────────────────


class WithholdingFinding(BaseModel):
    """One validation finding shown beside the record that caused it.

    ``key`` is what the reader translates; ``message`` is the English the rule
    wrote and is shown only where a locale has no string for the key yet.
    """

    key: str
    rule_id: str
    severity: str
    message: str
    suggestion: str = ""
    details: dict[str, Any] = Field(default_factory=dict)


class DeductionSaveResponse(BaseModel):
    """A saved deduction plus what validation made of it."""

    deduction: DeductionResponse
    findings: list[WithholdingFinding] = Field(default_factory=list)


class ReverseChargeSaveResponse(BaseModel):
    """A saved determination plus what validation made of it."""

    determination: ReverseChargeResponse
    findings: list[WithholdingFinding] = Field(default_factory=list)


__all__ = [
    "MAX_BANDS",
    "DeductionCreateRequest",
    "DeductionPreviewRequest",
    "DeductionPreviewResponse",
    "DeductionResponse",
    "DeductionSaveResponse",
    "DeductionUpdateRequest",
    "PartyStatusCreateRequest",
    "PartyStatusResponse",
    "PartyStatusUpdateRequest",
    "RateBand",
    "RegimeCreateRequest",
    "RegimeResponse",
    "RegimeSeedResponse",
    "RegimeUpdateRequest",
    "ReverseChargeCreateRequest",
    "ReverseChargeResponse",
    "ReverseChargeRuleResponse",
    "ReverseChargeSaveResponse",
    "ReverseChargeUpdateRequest",
    "WithholdingFinding",
]
