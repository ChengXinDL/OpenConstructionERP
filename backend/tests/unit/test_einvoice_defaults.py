# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Standing e-invoice configuration filling the gaps in one invoice's metadata.

Seller identity and the bank account are the same on every invoice a company
issues, so they belong to the instance rather than to the document. The document
still wins wherever it says something, because a value typed onto an invoice is
a deliberate departure from the standing configuration.

The checks that matter here are the ones a per-function test cannot see: the
validator and the renderer read the merged view through the same call, so a
merge that reached only one of them would let the panel report a document clean
and the download refuse to produce it.
"""

from __future__ import annotations

from decimal import Decimal

from app.modules.einvoice import build_einvoice, render_einvoice, violations_for
from app.modules.einvoice.rules import FATAL

_SETTINGS: dict = {
    "seller": {
        "name": "Hochbau Nord GmbH",
        "vat_id": "DE123456789",
        "country_code": "DE",
        "line1": "Werftstrasse 14",
        "postcode": "24143",
        "city": "Kiel",
    },
    "payee_iban": "DE02120300000000202051",
    "payee_account_name": "Hochbau Nord GmbH",
    "payment_terms": "Net 30 days",
}


def _invoice(einvoice_meta: dict | None = None) -> dict:
    return {
        "invoice_number": "RE-2026-0311",
        "invoice_date": "2026-08-11",
        "due_date": "2026-09-10",
        "currency_code": "EUR",
        "amount_subtotal": Decimal("1000.00"),
        "tax_amount": Decimal("190.00"),
        "metadata": {"einvoice": einvoice_meta} if einvoice_meta is not None else {},
    }


def _lines() -> list[dict]:
    return [
        {
            "description": "Concrete works",
            "unit": "m3",
            "quantity": Decimal("10"),
            "unit_rate": Decimal("100"),
            "amount": Decimal("1000.00"),
        }
    ]


def _buyer() -> dict:
    """What stays on the document itself: who is being invoiced, and their reference."""
    return {
        "buyer": {"name": "Stadtwerke Kiel", "country_code": "DE"},
        "buyer_reference": "991-01234-56",
    }


def test_a_seller_held_only_in_settings_reaches_both_the_check_and_the_document():
    """The one case a per-function test cannot catch.

    Nothing about the seller is on the invoice. If the merge reached the
    validator but not the renderer, the panel would report the document ready
    and the download would refuse it; if it reached the renderer but not the
    validator, the panel would demand data the document already carries.
    """
    invoice = _invoice(_buyer())

    found = violations_for(invoice=invoice, line_items=_lines(), profile="xrechnung", defaults=_SETTINGS)
    fatal = [v for v in found if v.severity == FATAL]
    assert fatal == [], [f"{v.rule_id}: {v.message}" for v in fatal]

    _name, _media, body = render_einvoice(invoice=invoice, line_items=_lines(), profile="xrechnung", defaults=_SETTINGS)
    xml = body.decode("utf-8")
    assert "Hochbau Nord GmbH" in xml
    assert "DE123456789" in xml
    assert "Werftstrasse 14" in xml


def test_the_invoice_own_seller_wins_over_the_configured_one():
    """A seller typed onto the document is an override, not a suggestion."""
    meta = dict(_buyer())
    meta["seller"] = {"name": "Tiefbau Sued GmbH", "vat_id": "DE987654321", "country_code": "DE"}

    ei = build_einvoice(invoice=_invoice(meta), line_items=_lines(), profile="xrechnung", defaults=_SETTINGS)

    assert ei.seller.name == "Tiefbau Sued GmbH"
    assert ei.seller.vat_id == "DE987654321"


def test_a_partly_named_seller_keeps_the_configured_address():
    """The merge is field-wise inside the party, not a choice between two parties.

    An invoice that renames the seller and says nothing about where it is must
    not lose the address, which is the shape a whole-object fallback would take
    while still passing the override test above.
    """
    meta = dict(_buyer())
    meta["seller"] = {"name": "Hochbau Nord GmbH, Niederlassung Kiel"}

    ei = build_einvoice(invoice=_invoice(meta), line_items=_lines(), profile="xrechnung", defaults=_SETTINGS)

    assert ei.seller.name == "Hochbau Nord GmbH, Niederlassung Kiel"
    assert ei.seller.line1 == "Werftstrasse 14"
    assert ei.seller.postcode == "24143"
    assert ei.seller.vat_id == "DE123456789"


def test_a_configured_account_makes_the_document_claim_a_credit_transfer():
    """BR-61: naming a transfer without an account is what the code guards."""
    ei = build_einvoice(invoice=_invoice(_buyer()), line_items=_lines(), profile="xrechnung", defaults=_SETTINGS)

    assert ei.payee_iban == "DE02120300000000202051"
    assert ei.payment_means_code == "30"
    assert ei.payment_terms == "Net 30 days"


def test_without_settings_the_document_is_exactly_what_it_was():
    """Every invoice written before this existed still renders unchanged."""
    meta = dict(_buyer())
    meta["seller"] = {"name": "Hochbau Nord GmbH", "vat_id": "DE123456789", "country_code": "DE"}
    invoice = _invoice(meta)

    _n1, _m1, before = render_einvoice(invoice=invoice, line_items=_lines(), profile="xrechnung")
    _n2, _m2, after = render_einvoice(invoice=invoice, line_items=_lines(), profile="xrechnung", defaults=None)

    assert before == after


def test_settings_never_overwrite_what_the_document_already_says():
    """A document that states every configured field is untouched by the configuration.

    Every key in ``_SETTINGS`` is answered here on purpose. A field the document
    leaves out is a gap the settings are meant to fill, so leaving one out would
    make this assert the opposite of what it claims to.
    """
    meta = dict(_buyer())
    meta["seller"] = {
        "name": "Tiefbau Sued GmbH",
        "vat_id": "DE987654321",
        "country_code": "DE",
        "line1": "Bahnhofstrasse 3",
        "postcode": "80331",
        "city": "Muenchen",
    }
    meta["payee_iban"] = "DE89370400440532013000"
    meta["payee_account_name"] = "Tiefbau Sued GmbH"
    meta["payment_terms"] = "Net 14 days"
    assert set(_SETTINGS) <= set(meta), "the document must answer every configured field"
    assert set(_SETTINGS["seller"]) <= set(meta["seller"]), "including every field of the seller"
    invoice = _invoice(meta)

    _n1, _m1, alone = render_einvoice(invoice=invoice, line_items=_lines(), profile="xrechnung")
    _n2, _m2, with_settings = render_einvoice(
        invoice=invoice, line_items=_lines(), profile="xrechnung", defaults=_SETTINGS
    )

    assert alone == with_settings


def test_an_explicit_seller_argument_still_outranks_the_configuration():
    """The existing override parameter keeps the meaning it already had."""
    ei = build_einvoice(
        invoice=_invoice(_buyer()),
        line_items=_lines(),
        profile="xrechnung",
        seller={"name": "Caller Wins GmbH", "country_code": "DE"},
        defaults=_SETTINGS,
    )

    assert ei.seller.name == "Caller Wins GmbH"
