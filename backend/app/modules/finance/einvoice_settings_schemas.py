# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Request and response shapes for the standing e-invoice configuration.

Validated here rather than at the screen, because the screen is one caller. The
rules are the ones a receiver would apply to the finished document, moved to the
point where the user can still see the field they are typing in.
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.einvoice.bank import InvalidBankDetail, normalise_bic, normalise_iban

__all__ = ["EInvoiceSettingsRead", "EInvoiceSettingsUpdate"]

_COUNTRY = re.compile(r"^[A-Z]{2}$")
# BT-31. Two letters for the country then the registration itself; the national
# formats differ too much to check further without a table per country, and a
# table that is wrong refuses a valid registration.
_VAT_ID = re.compile(r"^[A-Z]{2}[A-Z0-9 .\-]{2,18}$")
# UNTDID 4461. Numeric, and 30 (credit transfer) or 58 (SEPA) in practice.
_MEANS_CODE = re.compile(r"^[0-9]{1,4}$")
# ISO 6523 scheme identifier for BT-34, e.g. 0204 for the German Leitweg-ID.
_EAS_SCHEME = re.compile(r"^[0-9]{4}$")


class EInvoiceSettingsUpdate(BaseModel):
    """What a user may set. Every field optional: a half-filled form is normal."""

    model_config = ConfigDict(str_strip_whitespace=True)

    seller_name: str = Field(default="", max_length=200)
    seller_vat_id: str = Field(default="", max_length=50, examples=["DE123456789"])
    seller_tax_number: str = Field(default="", max_length=50)
    seller_legal_id: str = Field(default="", max_length=50)
    seller_country_code: str = Field(default="", max_length=2, examples=["DE"])
    seller_line1: str = Field(default="", max_length=200)
    seller_postcode: str = Field(default="", max_length=20)
    seller_city: str = Field(default="", max_length=100)
    seller_email: str = Field(default="", max_length=200)
    seller_electronic_address: str = Field(default="", max_length=200)
    seller_electronic_address_scheme: str = Field(default="", max_length=20, examples=["0204"])

    payee_iban: str = Field(default="", max_length=34, examples=["DE02120300000000202051"])
    payee_bic: str = Field(default="", max_length=11, examples=["COBADEFFXXX"])
    payee_account_name: str = Field(default="", max_length=200)
    payment_means_code: str = Field(default="", max_length=4, examples=["30"])
    payment_terms: str = Field(default="", max_length=500)

    @field_validator("seller_country_code")
    @classmethod
    def _check_country(cls, v: str) -> str:
        """BR-9: the seller's country is what decides which national rules apply."""
        if not v:
            return ""
        code = v.strip().upper()
        if not _COUNTRY.match(code):
            raise ValueError(f"country must be a two-letter ISO 3166-1 code such as DE, got {v!r}")
        return code

    @field_validator("seller_vat_id")
    @classmethod
    def _check_vat_id(cls, v: str) -> str:
        if not v:
            return ""
        vat = v.strip().upper()
        if not _VAT_ID.match(vat):
            raise ValueError(
                f"a VAT identifier starts with the two-letter country code and its registration, got {v!r}"
            )
        return vat

    @field_validator("payee_iban")
    @classmethod
    def _check_iban(cls, v: str) -> str:
        """BT-84. The one field on this screen no later step can check."""
        try:
            return normalise_iban(v, allow_empty=True)
        except InvalidBankDetail as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("payee_bic")
    @classmethod
    def _check_bic(cls, v: str) -> str:
        try:
            return normalise_bic(v, allow_empty=True)
        except InvalidBankDetail as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("payment_means_code")
    @classmethod
    def _check_means_code(cls, v: str) -> str:
        if not v:
            return ""
        code = v.strip()
        if not _MEANS_CODE.match(code):
            raise ValueError(f"a payment means code is a UNTDID 4461 number such as 30 or 58, got {v!r}")
        return code

    @field_validator("seller_electronic_address_scheme")
    @classmethod
    def _check_eas(cls, v: str) -> str:
        if not v:
            return ""
        scheme = v.strip()
        if not _EAS_SCHEME.match(scheme):
            raise ValueError(f"an electronic address scheme is a four-digit ISO 6523 code such as 0204, got {v!r}")
        return scheme


class EInvoiceSettingsRead(EInvoiceSettingsUpdate):
    """What is stored, plus what the screen needs to explain itself.

    ``complete`` answers the question the user actually has, which is whether
    filling this in was enough. It is deliberately not a compliance verdict on
    any invoice: an invoice still has to name its buyer and its buyer reference,
    and only the panel on the invoice can say whether it did.
    """

    complete: bool = False
    missing: list[str] = Field(default_factory=list)

    @classmethod
    def from_row(cls, row: Any) -> EInvoiceSettingsRead:
        stored = {name: getattr(row, name, "") or "" for name in EInvoiceSettingsUpdate.model_fields}
        missing = [f for f in ("seller_name", "seller_country_code") if not stored.get(f)]
        # A seller must be identified for tax either way round (BR-CO-26).
        if not (stored.get("seller_vat_id") or stored.get("seller_tax_number") or stored.get("seller_legal_id")):
            missing.append("seller_vat_id")
        return cls(**stored, complete=not missing, missing=missing)
