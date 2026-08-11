# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""The stored configuration and the document must speak one vocabulary.

A settings table whose columns do not reach the document is the failure this
guards: the user fills a field, the screen saves it, and the invoice is still
missing it, with nothing anywhere reporting a problem. So the parity check is
derived from the table itself rather than from a list someone maintains.
"""

from __future__ import annotations

from app.modules.einvoice.service import _merge_defaults
from app.modules.finance.einvoice_settings_models import EInvoiceSettings

# Columns that describe the row rather than the invoice.
_INFRASTRUCTURE = {"id", "scope", "updated_by", "created_at", "updated_at"}


def _stored_columns() -> set[str]:
    return {c.name for c in EInvoiceSettings.__table__.columns} - _INFRASTRUCTURE


def _filled() -> EInvoiceSettings:
    """Every invoice-bearing column set to something recognisable."""
    row = EInvoiceSettings()
    for name in _stored_columns():
        setattr(row, name, f"x-{name}")
    return row


def test_every_stored_field_reaches_the_document():
    """A column the document never sees is a field the user fills for nothing."""
    defaults = _filled().as_defaults()
    flat = dict(defaults)
    seller = flat.pop("seller", {})
    reached = {f"seller_{k}" for k in seller} | set(flat)

    missing = _stored_columns() - reached
    assert missing == set(), f"columns that never reach an invoice: {sorted(missing)}"


def test_every_field_the_document_receives_is_one_a_document_reads():
    """The mirror of the above: nothing invented on the way out.

    ``build_einvoice`` reads a fixed set of keys, so a default under any other
    name is silently discarded, which looks exactly like the column not being
    saved.
    """
    read_by_the_document = {
        "seller",
        "buyer",
        "buyer_reference",
        "leitweg_id",
        "order_reference",
        "payee_iban",
        "iban",
        "payee_bic",
        "bic",
        "payee_account_name",
        "account_holder",
        "payment_means_code",
        "payment_terms",
        "vat_rate",
        "vat_category",
        "tax_currency",
        "tax_total_in_tax_currency",
    }
    unread = set(_filled().as_defaults()) - read_by_the_document
    assert unread == set(), f"defaults no invoice would ever read: {sorted(unread)}"


def test_an_empty_configuration_offers_nothing():
    """An unset instance must not blank out what an invoice already carries."""
    assert EInvoiceSettings().as_defaults() == {}

    invoice_meta = {"seller": {"name": "Tiefbau Sued GmbH"}, "payee_iban": "DE02120300000000202051"}
    assert _merge_defaults(invoice_meta, EInvoiceSettings().as_defaults()) == invoice_meta


def test_a_partly_filled_configuration_offers_only_what_it_holds():
    row = EInvoiceSettings()
    row.seller_name = "Hochbau Nord GmbH"
    row.payee_iban = "DE02120300000000202051"

    assert row.as_defaults() == {
        "seller": {"name": "Hochbau Nord GmbH"},
        "payee_iban": "DE02120300000000202051",
    }
